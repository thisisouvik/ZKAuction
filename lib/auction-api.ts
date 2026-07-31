/**
 * lib/auction-api.ts — AuctionAPI: The Core Business Logic Layer
 *
 * This class is the bridge between the Next.js UI and the Midnight blockchain.
 * It wraps the Compact contract circuits in clean async TypeScript methods.
 *
 * FLOW for each operation:
 * ─────────────────────────
 *  1. UI calls e.g. api.placeBid({ amount: 1000n, contract_address: '0x...' })
 *  2. AuctionAPI calls findDeployedContract() to get the deployed contract handle
 *  3. Calls deployed.callTx.placeBid(args) which:
 *     a. Calls the TypeScript witness functions (local_secret_key, etc.)
 *     b. Sends private data to the LOCAL proof server → ZK proof generated
 *     c. Wallet balances the tx (adds fee UTXOs)
 *     d. Wallet submits the balanced proven tx to the Midnight node
 *  4. API waits for the tx to be finalized and returns TxResult
 *
 * IMPORTANT — compactc dependency:
 * ────────────────────────────────
 * The actual `deployed.callTx.*` API comes from the COMPILED CONTRACT.
 * When Phase 1's `npm run compile:contract` runs compactc, it generates:
 *   contract/src/generated/index.cjs  ← the compiled contract object
 *   contract/src/generated/index.d.ts ← TypeScript types for all circuits
 *
 * Until then, this file uses `any` in places where generated types would go.
 * When you run compactc, replace `any` with the generated Contract type.
 * The method signatures and logic remain IDENTICAL — only types change.
 *
 * Usage (from a React component):
 * ─────────────────────────────────
 * ```tsx
 * const api = await AuctionAPI.connect(walletConnector);
 *
 * // Seller deploys and creates auction
 * const address = await api.deploy({ duration_blocks: 100n, reserve_price: 1000n, ... });
 *
 * // Bidder places a bid
 * const result = await api.placeBid({ amount: 1200n, contract_address: address });
 * ```
 */

import {
  createUnprovenDeployTx,
  submitTxAsync,
  submitCallTxAsync,
  getPublicStates,
  type ContractProviders,
} from '@midnight-ntwrk/midnight-js-contracts';
import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { CompiledContract } from '@midnight-ntwrk/compact-js/effect';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  AuctionStatus,
  AuctionApiError,
  AuctionErrorCode,
  type AuctionState,
  type CreateAuctionParams,
  type PlaceBidParams,
  type TxResult,
} from './types';
import {
  buildProviders,
  getNetworkConfig,
  type AuctionProviders,
  type AuctionPrivateState,
  type MidnightWalletConnector,
} from './providers';
import { createHash, randomBytes } from 'crypto';

// ── Private State ID ──────────────────────────────────────────────────────────
// Used as the key when storing/retrieving private state from the provider.
// Each deployed contract gets its own private state bucket.
const PRIVATE_STATE_ID = 'zkauction-private-state-v1';

// ── Witness Implementation Interface ─────────────────────────────────────────
// These TypeScript functions implement the Compact `witness` declarations.
// They are called by the proof server during proof generation.
// The returned values are PRIVATE — they go into the ZK circuit, not on-chain.
interface AuctionWitnesses {
  // Returns the user's private Midnight secret key
  // In real integration: derived from the 1AM wallet's key material
  local_secret_key: () => Uint8Array;

  // Returns the reserve price (seller only)
  reserve_price?: () => bigint;

  // Returns the commitment salt (seller only)
  commitment_salt?: () => Uint8Array;
}

// ── AuctionAPI Class ──────────────────────────────────────────────────────────
export class AuctionAPI {
  private constructor(
    private readonly providers: AuctionProviders,
    private readonly witnesses: AuctionWitnesses,
    private readonly walletAddress: string
  ) {}

  // ── Factory: Create a connected AuctionAPI instance ────────────────────────
  /**
   * Creates an AuctionAPI by connecting to the 1AM wallet and building
   * the full Midnight provider stack.
   *
   * CALL THIS ONCE in your React context/provider, then pass the instance down.
   *
   * @param walletConnector — obtained from connectWallet() in providers.ts
   * @returns Connected AuctionAPI instance ready to call circuits
   */
  static async connect(walletConnector: MidnightWalletConnector): Promise<AuctionAPI> {
    // Set the global network ID — this MUST exactly match what the 1AM wallet expects.
    // The env var NEXT_PUBLIC_MIDNIGHT_NETWORK should be 'preview', 'preprod', or 'devnet'.
    const networkId = (process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'preview').toLowerCase();
    setNetworkId(networkId);
    console.log('[ZKAuction] Set network ID to:', networkId);

    // Get wallet address — the 1AM wallet may return address as a property (string)
    // OR as an async function. We handle both shapes here.
    const walletAddress = await resolveAddress(walletConnector);

    // Build the 6-provider stack
    const network = getNetworkConfig();
    const providers = await buildProviders({ network, walletConnector, walletAddress });

    // Derive the ZK secret key from wallet.
    // In production: use wallet's key derivation API.
    // Here: derive from wallet address (deterministic, consistent per wallet).
    // The proof server needs this as a Uint8Array to compute persistentHash.
    const secretKeyBytes = deriveSecretKeyFromAddress(walletAddress);

    const witnesses: AuctionWitnesses = {
      local_secret_key: () => secretKeyBytes,
    };

    return new AuctionAPI(providers, witnesses, walletAddress);
  }

  // ── Deploy: Deploy a new auction contract ──────────────────────────────────
  /**
   * Deploys a new ZKAuction contract to Midnight Preprod.
   * Only the SELLER calls this. A new contract address is returned.
   *
   * Internally this calls:
   *  1. deployContract() — creates the contract on-chain
   *  2. createAuction()  — configures it with duration + commitment
   *
   * The reserve_price and salt are stored LOCALLY in private state.
   * They are NEVER sent to any server or stored on-chain.
   *
   * @returns The deployed contract address (share this with bidders)
   */
  async deploy(params: CreateAuctionParams): Promise<string> {
    this.ensureProviders();

    const salt = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(salt);
    } else {
      // Fallback for node environments if needed
      salt.set(randomBytes(32));
    }
    
    const privateState: AuctionPrivateState = {
      local_secret_key: this.witnesses.local_secret_key(),
      reserve_price:    params.reserve_price,
      commitment_salt:  salt,
    };
    const itemHash = hashItemDescription(params.item_description);

    try {
      const compiledContract = await buildCompiledContract(privateState);
      await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState);

      // ── Step 1: Create the unproven deploy transaction ──────────────────
      // MUST use createUnprovenDeployTx + submitTxAsync instead of deployContract()
      // because deployContract() hangs indefinitely on the Preview network.
      const deployTxData = await (createUnprovenDeployTx as any)(
        {
          zkConfigProvider: this.providers.zkConfigProvider,
          walletProvider:   this.providers.walletProvider,
        },
        {
          compiledContract,
          privateStateId:      PRIVATE_STATE_ID,
          initialPrivateState: privateState,
          signingKey:          sampleSigningKey(),
        }
      );

      const contractAddress: string = deployTxData.public.contractAddress;

      // ── Step 1.5: Scope Private State ──────────────────────────────────────
      // Now that the contract address is generated, we must scope the private
      // state provider to this specific contract and re-save it, so subsequent
      // circuit calls (and page reloads) can find it.
      if (this.providers.privateStateProvider && (this.providers.privateStateProvider as any).setContractAddress) {
        (this.providers.privateStateProvider as any).setContractAddress(contractAddress);
      }
      await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState);

      // ── Step 2: Submit the deploy transaction ────────────────────────────
      await (submitTxAsync as any)(this.providers, {
        unprovenTx: deployTxData.private.unprovenTx,
      });

      // ── Wait for Indexer ──────────────────────────────────────────────────
      // Before we can call a circuit on the deployed contract, we MUST wait
      // for the indexer to see the new state. Otherwise submitCallTxAsync fails
      // or causes a "Duplicate request" wallet error.
      let indexed = false;
      for (let i = 0; i < 30; i++) {
        try {
          await this.getState(contractAddress);
          indexed = true;
          break;
        } catch (e) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s
        }
      }
      if (!indexed) {
        throw new Error("Contract deployed, but took too long to index. Please refresh and try again later.");
      }

      // ── Give Wallet Extension time to reset ────────────────────────────────
      // Even if the indexer sees the contract, the 1AM wallet might still be
      // cleaning up its internal state from the previous submitTransaction popup.
      // If we hit it too fast, it throws "Duplicate request".
      await new Promise(resolve => setTimeout(resolve, 3000));

      // ── Step 3: Call the createAuction circuit ───────────────────────────
      await (submitCallTxAsync as any)(this.providers, {
        compiledContract,
        contractAddress,
        circuitId:    'createAuction',
        args:         [params.duration_blocks, new Uint8Array(itemHash)],
        privateStateId: PRIVATE_STATE_ID,
      });

      return contractAddress;
    } catch (error) {
      throw new AuctionApiError(
        AuctionErrorCode.CIRCUIT_CALL_FAILED,
        `Failed to deploy auction: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }


  // ── placeBid: Submit a bid ─────────────────────────────────────────────────
  /**
   * Places a bid on an existing auction.
   *
   * ZK guarantees provided by the placeBid circuit:
   *  ✅ bid_amount > current highest_bid
   *  ✅ Auction status is OPEN
   *  ✅ Bidder's ZK identity is derived from their secret key (not wallet)
   *
   * The bidder's real wallet address is NEVER stored on-chain.
   *
   * @param params - { amount: bigint, contract_address: string }
   * @returns TxResult with transaction hash and updated auction state
   */
  async placeBid(params: PlaceBidParams): Promise<TxResult> {
    this.ensureProviders();

    try {
      if (this.providers.privateStateProvider && (this.providers.privateStateProvider as any).setContractAddress) {
        (this.providers.privateStateProvider as any).setContractAddress(params.contract_address);
      }
      
      let storedState: AuctionPrivateState | null = null;
      try {
        storedState = await this.providers.privateStateProvider.get(PRIVATE_STATE_ID);
      } catch (e: any) {
        // Ignore, handled below
      }
      if (!storedState) {
        // If not found or null, initialize it (needed for bidders)
        storedState = { local_secret_key: this.witnesses.local_secret_key() };
        await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, storedState);
      }
      
      const compiledContract = await buildCompiledContract(storedState);

      await (submitCallTxAsync as any)(this.providers, {
        compiledContract,
        contractAddress: params.contract_address,
        circuitId:       'placeBid',
        args:            [params.amount],
        privateStateId:  PRIVATE_STATE_ID,
      });

      const newState = await this.getState(params.contract_address);
      return { txHash: '', blockHeight: 0, timestamp: Date.now(), newState };
    } catch (error) {
      throw new AuctionApiError(
        AuctionErrorCode.CIRCUIT_CALL_FAILED,
        `placeBid failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  // ── settle: Seller settles the auction ────────────────────────────────────
  /**
   * Called by the seller after the auction's end block has passed.
   *
   * The seller provides (reserve_price, salt) as ZK witnesses.
   * The circuit verifies: persistentHash(salt) == on-chain reserve_commitment
   * Then compares highest_bid vs reserve_price to determine SETTLED or EXPIRED.
   *
   * The reserve_price itself is NEVER disclosed — only the comparison result.
   *
   * @param contractAddress - The deployed contract address
   * @returns TxResult — status is either SETTLED or EXPIRED
   */
  async settle(contractAddress: string): Promise<TxResult> {
    this.ensureProviders();

    if (this.providers.privateStateProvider && (this.providers.privateStateProvider as any).setContractAddress) {
      (this.providers.privateStateProvider as any).setContractAddress(contractAddress);
    }
    const privateState = await this.providers.privateStateProvider.get(PRIVATE_STATE_ID);
    if (!privateState?.reserve_price || !privateState?.commitment_salt) {
      throw new AuctionApiError(
        AuctionErrorCode.INVALID_STATE,
        'Cannot settle: seller private state (reserve price + salt) not found locally.'
      );
    }

    try {
      const compiledContract = await buildCompiledContract(privateState);

      await (submitCallTxAsync as any)(this.providers, {
        compiledContract,
        contractAddress,
        circuitId:      'settle',
        args:           [],
        privateStateId: PRIVATE_STATE_ID,
      });

      const newState = await this.getState(contractAddress);
      return { txHash: '', blockHeight: 0, timestamp: Date.now(), newState };
    } catch (error) {
      throw new AuctionApiError(
        AuctionErrorCode.CIRCUIT_CALL_FAILED,
        `settle failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  // ── withdrawExpired: Cleanup after expired auction ─────────────────────────
  /**
   * Called by the seller or losing bidder after the auction status is EXPIRED.
   *
   * settle() must be called first. Once EXPIRED status is set, the seller
   * and/or the highest bidder can call this to acknowledge and clean up.
   *
   * In a full token implementation, this would trigger refund of the bid.
   *
   * @param contractAddress - The deployed contract address
   * @returns TxResult
   */
  async withdrawExpired(contractAddress: string): Promise<TxResult> {
    this.ensureProviders();

    try {
      if (this.providers.privateStateProvider && (this.providers.privateStateProvider as any).setContractAddress) {
        (this.providers.privateStateProvider as any).setContractAddress(contractAddress);
      }

      let storedState: AuctionPrivateState | null = null;
      try {
        storedState = await this.providers.privateStateProvider.get(PRIVATE_STATE_ID);
      } catch (e: any) {
        // Ignore, handled below
      }
      if (!storedState) {
        // Should not happen for seller, but fallback to be safe
        storedState = { local_secret_key: this.witnesses.local_secret_key() };
        await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, storedState);
      }

      const compiledContract = await buildCompiledContract(storedState);

      await (submitCallTxAsync as any)(this.providers, {
        compiledContract,
        contractAddress,
        circuitId:      'withdrawExpired',
        args:           [],
        privateStateId: PRIVATE_STATE_ID,
      });

      const newState = await this.getState(contractAddress);
      return { txHash: '', blockHeight: 0, timestamp: Date.now(), newState };
    } catch (error) {
      throw new AuctionApiError(
        AuctionErrorCode.CIRCUIT_CALL_FAILED,
        `withdrawExpired failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  // ── getState: Read on-chain auction state ─────────────────────────────────
  /**
   * Reads the current public ledger state for a given contract address.
   * This is a READ operation — no proof generation, no transaction.
   *
   * The returned state is ENTIRELY PUBLIC — an observer can read the same data.
   * The reserve price is NOT in the returned state (only the commitment hash).
   *
   * @param contractAddress - The deployed contract address
   * @returns AuctionState — the decoded public ledger fields
   */
  async getState(contractAddress: string): Promise<AuctionState> {
    this.ensureProviders();

    try {
      const states = await getPublicStates(
        this.providers.publicDataProvider as any,
        contractAddress
      ) as any;

      if (!states || !states.contractState || !states.contractState.data) {
        throw new AuctionApiError(
          AuctionErrorCode.CONTRACT_NOT_FOUND,
          `No state found for contract ${contractAddress}. Is it deployed to this network?`
        );
      }

      // Decode the raw ledger bytes using the generated `ledger` function
      const mod = await loadCompiledContractModule();
      const decodedData = mod.ledger(states.contractState.data);

      // Map the decoded ledger object into our TypeScript AuctionState type
      return decodeAuctionState(decodedData);
    } catch (error) {
      if (error instanceof AuctionApiError) throw error;
      throw new AuctionApiError(
        AuctionErrorCode.NETWORK_ERROR,
        `Failed to read state: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  // ── Helper: Verify provider readiness ────────────────────────────────────
  private ensureProviders(): void {
    if (!this.providers) {
      throw new AuctionApiError(
        AuctionErrorCode.PROVIDERS_NOT_READY,
        'AuctionAPI not connected. Call AuctionAPI.connect(walletConnector) first.'
      );
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Derives a 32-byte secret key from a wallet address.
 *
 * In production: The 1AM wallet's key derivation API should be used.
 * This is a deterministic fallback that creates a consistent key per address.
 *
 * The key is used as the `local_secret_key()` witness input. It must be:
 *  - Deterministic (same wallet → same key, always)
 *  - Private (never logged, never sent anywhere)
 *  - 32 bytes
 */
function deriveSecretKeyFromAddress(address: string): Uint8Array {
  // In production replace with: wallet.deriveKey('zkauction-v1')
  const hash = createHash('sha256')
    .update('zkauction-secret-key-derivation-v1:')
    .update(address)
    .digest();
  return new Uint8Array(hash);
}

/**
 * Hashes an item description string to a 32-byte array for on-chain storage.
 * The actual description stays off-chain — only the hash is public.
 */
function hashItemDescription(description: string): Buffer {
  return createHash('sha256')
    .update(description)
    .digest();
}

/**
 * Decodes raw public ledger state from the indexer into AuctionState.
 *
 * The indexer returns raw binary/hex data from the Compact ledger fields.
 * This function maps them to our typed AuctionState interface.
 *
 * NOTE: The exact field names and decoding depend on the compactc output.
 * This is a best-effort decoder that will be updated once compactc runs.
 */
function decodeAuctionState(rawState: unknown): AuctionState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = rawState as any;

  // Map the raw Compact ledger fields to our TypeScript interface
  return {
    seller:             toHex(s?.seller ?? new Uint8Array(32)),
    reserve_commitment: toHex(s?.reserve_commitment ?? new Uint8Array(32)),
    highest_bid:        BigInt(s?.highest_bid ?? 0),
    highest_bidder:     toHex(s?.highest_bidder ?? new Uint8Array(32)),
    auction_end_block:  BigInt(s?.auction_end_block ?? 0),
    status:             decodeStatus(s?.status),
    bid_count:          Number(s?.bid_count ?? 0),
    item_hash:          toHex(s?.item_hash ?? new Uint8Array(32)),
  };
}

function decodeStatus(raw: unknown): AuctionStatus {
  if (raw === 'SETTLED' || raw === 1) return AuctionStatus.SETTLED;
  if (raw === 'EXPIRED'  || raw === 2) return AuctionStatus.EXPIRED;
  return AuctionStatus.OPEN;
}

function toHex(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') return bytes;
  return Buffer.from(bytes).toString('hex');
}

/**
 * Loads the compiled Compact contract module and returns its named exports.
 *
 * The generated module exports:
 *   - `Contract` (class)  — must be instantiated with `new Contract(witnesses)`
 *   - `ledger` (function) — decodes raw state values
 *   - `AuctionStatus` (enum)
 *
 * IMPORTANT: Do NOT pass the Contract class directly to deployContract.
 *            Always instantiate it first: `new Contract(witnesses)`.
 */
async function loadCompiledContractModule(): Promise<any> {
  try {
    // @ts-ignore — generated by compactc during `npm run compile:contract`
    const mod = await import('../contract/src/generated/contract/index.js');
    // The module may export as ESM named exports or as a default object
    if (mod && mod.Contract) return mod;
    if (mod?.default?.Contract) return mod.default;
    throw new Error('Contract class not found in generated module');
  } catch (e: any) {
    if (e?.code === 'MODULE_NOT_FOUND' || e?.message?.includes('Cannot find module') || e?.message?.includes('not found')) {
      throw new AuctionApiError(
        AuctionErrorCode.PROVIDERS_NOT_READY,
        'Compiled contract not found at contract/src/generated/contract/index.js.\n' +
        'Run: npm run compile:contract\n' +
        'This requires the Midnight compact compiler to be installed.'
      );
    }
    throw e;
  }
}

/**
 * Resolves the wallet address from a connector.
 * Supports ALL Midnight address formats:
 *   - Old testnet: tds1... (shielded), tdu1... (unshielded)
 *   - New preview/preprod/mainnet: mn_shield-addr_preview..., mn_addr_...
 *   - Via async functions or plain string properties
 */
async function resolveAddress(connector: any): Promise<string> {
  try {
    if (typeof connector.address === 'function') {
      const result = await connector.address();
      if (typeof result === 'string' && result) return result;
    }
    if (typeof connector.address === 'string' && connector.address) {
      return connector.address;
    }

    /**
     * Returns true if the string looks like any valid Midnight address.
     * Supports:  tds1…  tdu1…  mn_shield-addr_…  mn_…
     */
    const isMidnightAddress = (s: string): boolean =>
      s.startsWith('tds1') ||
      s.startsWith('tdu1') ||
      s.startsWith('mn_shield-addr_') ||
      s.startsWith('mn_addr_') ||
      s.startsWith('mn1');        // fallback for any mn-prefixed bech32

    /**
     * Extracts a Midnight address string from any arbitrary value:
     * string | string[] | { shieldedAddress, unshieldedAddress, ... } | nested object
     */
    const extractAddress = (res: any): string | null => {
      if (!res) return null;

      // Plain string
      if (typeof res === 'string') {
        return res.length > 10 ? res : null; // accept any non-trivial string
      }

      // Direct object properties — checked in priority order
      if (typeof res === 'object') {
        // The 1AM wallet on preview/preprod returns { shieldedAddress, shieldedCoinPublicKey, ... }
        if (typeof res.shieldedAddress === 'string' && res.shieldedAddress) return res.shieldedAddress;
        if (typeof res.unshieldedAddress === 'string' && res.unshieldedAddress) return res.unshieldedAddress;
        if (typeof res.address === 'string' && res.address) return res.address;
        if (typeof res.coinPublicKey === 'string' && res.coinPublicKey) return res.coinPublicKey;
      }

      // Array — take first valid element
      if (Array.isArray(res) && res.length > 0) {
        const first = res[0];
        if (typeof first === 'string') return first;
        return extractAddress(first);
      }

      // Deep recursive scan as last resort
      if (typeof res === 'object') {
        for (const key of Object.keys(res)) {
          const val = res[key];
          if (typeof val === 'string' && isMidnightAddress(val)) return val;
        }
        for (const key of Object.keys(res)) {
          const found = extractAddress(res[key]);
          if (found) return found;
        }
      }

      return null;
    };

    if (typeof connector.getShieldedAddresses === 'function') {
      const rawRes = await connector.getShieldedAddresses();
      console.log('[ZKAuction] getShieldedAddresses raw:', JSON.stringify(rawRes, (k, v) => typeof v === 'bigint' ? v.toString() : v));
      const addr = extractAddress(rawRes);
      if (addr) return addr;
    }
    if (typeof connector.getAddress === 'function') {
      const addr = extractAddress(await connector.getAddress());
      if (addr) return addr;
    }
    if (typeof connector.getUnshieldedAddress === 'function') {
      const addr = extractAddress(await connector.getUnshieldedAddress());
      if (addr) return addr;
    }
    if (typeof connector.state === 'function') {
      const state = await connector.state();
      if (state?.address) return state.address;
      if (state?.coinPublicKey) return state.coinPublicKey;
    }

    // Last resort — return 'unknown' and let extractKeysFromConnectorOrAddress handle it
    console.warn('[ZKAuction] Could not resolve wallet address. Connector:', connector);
    return 'unknown';
  } catch (e) {
    console.warn('[ZKAuction] Error resolving address:', e);
    return 'unknown';
  }
}

/**
 * Builds a fully configured `CompiledContract` ready to pass to `deployContract` / `findDeployedContract`.
 *
 * The SDK requires:
 *   1. CompiledContract.make(tag, ContractClass)   — registers the class (stored as .ctor internally)
 *   2. .withWitnesses(witnesses)                   — attaches the witness functions
 *   3. .withCompiledFileAssets(keysDir)            — points to the .prover / .verifier key files
 *
 * The witness functions follow the Compact calling convention:
 *   (ctx: WitnessContext<Ledger, PrivateState>) => [updatedPrivateState, witnessValue]
 *
 * @param privateState — the current private state (can be null for bidder reads)
 */
async function buildCompiledContract(privateState: any): Promise<any> {
  // Load the generated Contract class (compactc output)
  let ContractClass: any;
  try {
    // @ts-ignore — generated by compactc
    const mod = await import('../contract/src/generated/contract/index.js');
    ContractClass = mod.Contract ?? mod.default?.Contract;
    if (!ContractClass) throw new Error('Contract class not found in generated module');
  } catch (e: any) {
    const isNotFound = e?.message?.includes('Cannot find module') || e?.message?.includes('not found') || e?.code === 'MODULE_NOT_FOUND';
    if (isNotFound || e instanceof AuctionApiError) {
      throw new AuctionApiError(
        AuctionErrorCode.PROVIDERS_NOT_READY,
        'Compiled contract not found.\nRun: npm run compile:contract\n(Requires the Midnight compact compiler.)'
      );
    }
    throw e;
  }

  /**
   * Witness functions — read from the current private state each time they are called.
   * The Compact runtime passes `ctx` which carries `ctx.privateState`.
   * We return [unchanged_private_state, witness_value].
   */
  const witnesses = {
    local_secret_key: (ctx: any) => [ctx.privateState, ctx.privateState?.local_secret_key ?? new Uint8Array(32)],
    reserve_price:    (ctx: any) => [ctx.privateState, ctx.privateState?.reserve_price    ?? 0n],
    commitment_salt:  (ctx: any) => [ctx.privateState, ctx.privateState?.commitment_salt  ?? new Uint8Array(32)],
  };

  // In the browser, withCompiledFileAssets uses fetch() to load key files.
  // We serve the compiled keys from public/keys/ so they are accessible at /keys/*.
  // Next.js automatically serves everything in /public as static assets.
  //
  // SDK will fetch: /keys/createAuction.verifier, /keys/placeBid.prover, etc.
  const keysBaseUrl = '/keys';

  // Build using the CompiledContract pipeline (imperative style to avoid TS generic issues)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step1: any = CompiledContract.make('zkauction-v1', ContractClass);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step2: any = (CompiledContract.withWitnesses as any)(step1, witnesses);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step3: any = (CompiledContract.withCompiledFileAssets as any)(step2, keysBaseUrl);
  return step3;
}
