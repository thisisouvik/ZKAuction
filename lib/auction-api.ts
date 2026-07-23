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
  deployContract,
  findDeployedContract,
  getPublicStates,
  type ContractProviders,
} from '@midnight-ntwrk/midnight-js-contracts';
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
    // Set the network (TestNet = Midnight Preprod)
    // This MUST be called before any SDK operation
    const networkEnv = process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'TestNet';
    setNetworkId(networkEnv === 'DevNet' ? 'DevNet' : 'TestNet');

    // Build the 6-provider stack
    const network = getNetworkConfig();
    const providers = await buildProviders({ network, walletConnector });

    // Get wallet address for display and access control checks
    const walletAddress = await walletConnector.address().catch(() => 'unknown');

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

    // Generate a fresh random salt for the commitment
    const salt = randomBytes(32);

    // Store private seller state BEFORE deploying
    // This ensures the seller can settle even if the page refreshes
    const privateState: AuctionPrivateState = {
      local_secret_key:  this.witnesses.local_secret_key(),
      reserve_price:     params.reserve_price,
      commitment_salt:   salt,
    };

    // Extend witnesses with seller-specific private values
    const sellerWitnesses = {
      ...this.witnesses,
      reserve_price:    () => params.reserve_price,
      commitment_salt:  () => salt,
    };

    // Hash the item description for on-chain storage
    const itemHash = hashItemDescription(params.item_description);

    try {
      // ─ Deploy the contract (creates the UTXO on Midnight) ─────────────────
      // compiledContract comes from the compactc output (generated/index.cjs)
      // Until compactc runs, this uses a placeholder. Replace with:
      //   import { Contract } from '../contract/src/generated';
      //   const compiledContract = Contract;
      const compiledContract = await loadCompiledContract();

      await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState);

      const deployed = await deployContract(
        this.providers as any,
        {
          compiledContract: compiledContract as any,
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: privateState,
        } as any
      ) as any;

      const contractAddress = deployed.deployTxData.public.contractAddress;

      // ─ Call createAuction() circuit ───────────────────────────────────────
      // This sets the reserve_commitment, duration, item_hash on-chain.
      // The reserve_price never leaves the proof server.
      await deployed.callTx.createAuction(
        params.duration_blocks,
        new Uint8Array(itemHash)
      );

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
      const compiledContract = await loadCompiledContract();
      const found = await findDeployedContract(
        this.providers as any,
        {
          compiledContract: compiledContract as any,
          contractAddress: params.contract_address,
          privateStateId:  PRIVATE_STATE_ID,
        } as any
      ) as any;

      const txData = await found.callTx.placeBid(params.amount) as any;
      const newState = await this.getState(params.contract_address);

      return {
        txHash:      txData.txHash ?? '',
        blockHeight: txData.blockHeight ?? 0,
        timestamp:   Date.now(),
        newState,
      };
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

    // Load the seller's private state from local storage
    const privateState = await this.providers.privateStateProvider.get(PRIVATE_STATE_ID);
    if (!privateState?.reserve_price || !privateState?.commitment_salt) {
      throw new AuctionApiError(
        AuctionErrorCode.INVALID_STATE,
        'Cannot settle: seller private state (reserve price + salt) not found locally. ' +
        'Did you create this auction on a different device or browser?'
      );
    }

    try {
      const compiledContract = await loadCompiledContract();
      const found = await findDeployedContract(
        this.providers as any,
        {
          compiledContract: compiledContract as any,
          contractAddress,
          privateStateId: PRIVATE_STATE_ID,
        } as any
      ) as any;

      const txData = await found.callTx.settle() as any;
      const newState = await this.getState(contractAddress);

      return {
        txHash:      txData.txHash ?? '',
        blockHeight: txData.blockHeight ?? 0,
        timestamp:   Date.now(),
        newState,
      };
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
      const compiledContract = await loadCompiledContract();
      const found = await findDeployedContract(
        this.providers as any,
        {
          compiledContract: compiledContract as any,
          contractAddress,
          privateStateId: PRIVATE_STATE_ID,
        } as any
      ) as any;

      const txData = await found.callTx.withdrawExpired() as any;
      const newState = await this.getState(contractAddress);

      return {
        txHash:      txData.txHash ?? '',
        blockHeight: txData.blockHeight ?? 0,
        timestamp:   Date.now(),
        newState,
      };
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

      if (!states || states.length === 0) {
        throw new AuctionApiError(
          AuctionErrorCode.CONTRACT_NOT_FOUND,
          `No state found for contract ${contractAddress}. Is it deployed to this network?`
        );
      }

      // Decode the raw ledger state into our TypeScript AuctionState type
      return decodeAuctionState(states[states.length - 1]);
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
 * Loads the compiled Compact contract.
 *
 * After `npm run compile:contract` generates the contract output, replace this
 * with a direct import:
 *
 *   import { Contract } from '../contract/src/generated';
 *   export function loadCompiledContract() { return Contract; }
 *
 * Until then, this throws a helpful error explaining what to do.
 */
async function loadCompiledContract(): Promise<unknown> {
  try {
    // @ts-ignore - this file is generated during the build step by compactc
    const generated = await import('../contract/src/generated/index.cjs');
    return generated.default ?? generated;
  } catch {
    throw new AuctionApiError(
      AuctionErrorCode.PROVIDERS_NOT_READY,
      'Compiled contract not found at contract/src/generated/index.cjs.\n' +
      'Run: npm run compile:contract\n' +
      'This requires the compactc compiler to be installed (see Phase 1 docs).'
    );
  }
}
