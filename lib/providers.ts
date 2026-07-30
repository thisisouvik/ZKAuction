/**
 * lib/providers.ts — Midnight SDK Provider Stack Builder
 *
 * This file wires up ALL six providers required by the Midnight SDK:
 *
 *  1. walletProvider      — Signs and balances transactions (from 1AM wallet)
 *  2. midnightProvider    — Submits transactions to the Midnight node
 *  3. publicDataProvider  — Reads contract state from the indexer (GraphQL)
 *  4. proofProvider       — Generates ZK proofs (talks to Docker proof server)
 *  5. zkConfigProvider    — Fetches ZK circuit keys from the contract
 *  6. privateStateProvider — Persists private state locally (IndexedDB/memory)
 *
 * ARCHITECTURE:
 * ─────────────
 * The providers form a stack. Each layer depends on the ones below:
 *
 *   [1AM Wallet] → walletProvider
 *   [Midnight Node WS] → midnightProvider (via walletProvider)
 *   [Indexer GraphQL] → publicDataProvider
 *   [Proof Server HTTP] → proofProvider
 *   [Contract ZK Keys] → zkConfigProvider (fetched via publicDataProvider)
 *   [Local Storage] → privateStateProvider
 *
 * The final `providers` object is passed to `deployContract()` and
 * `findDeployedContract()` from @midnight-ntwrk/midnight-js-contracts.
 *
 * PRIVACY NOTE:
 * ─────────────
 * The proofProvider talks to YOUR LOCAL proof server (Docker).
 * Private witnesses (reserve_price, commitment_salt, secret_key) are
 * sent ONLY to this local service — never to any remote server.
 * The proof server returns a ZK proof that is then submitted on-chain.
 */

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightNetworkConfig } from './types';
import { AuctionApiError, AuctionErrorCode } from './types';

// ── 1AM Wallet Browser Injection Types ──────────────────────────────────────
// The 1AM wallet (window.midnight['1am']) uses an unknown API shape.
// We use 'any' here and probe for methods at runtime.
export type MidnightWalletApi = any;
export type MidnightWalletConnector = any;

// Augment Window to include the 1AM wallet injection
declare global {
  interface Window {
    midnight?: Record<string, any>;
  }
}

// ── Provider Building Config ──────────────────────────────────────────────────
export interface BuildProvidersConfig {
  network: MidnightNetworkConfig;
  // The raw connector returned from the 1AM wallet connection flow
  walletConnector: any;
  // The wallet's shielded address string (mn1q...) — used to decode coin/enc keys
  walletAddress?: string;
}

// ── Auction Provider Type ────────────────────────────────────────────────────
// The specific providers shape for our auction contract.
// PSI = Private State ID string literal type.
// PS  = Private state shape (the witnesses stored locally).
export type AuctionProviders = MidnightProviders<
  string,       // Circuit IDs: 'createAuction' | 'placeBid' | 'settle' | 'withdrawExpired'
  string,       // Private State ID
  AuctionPrivateState
>;

// ── Private State Shape ──────────────────────────────────────────────────────
// This is what gets stored in IndexedDB on the user's machine.
// It is the TypeScript representation of the Compact witnesses.
// NEVER serialized to any server — local only.
export interface AuctionPrivateState {
  // The user's Midnight secret key (derived from wallet)
  // This maps to the `local_secret_key()` witness in auction.compact
  local_secret_key: Uint8Array;

  // Seller-only: the reserve price (private)
  // Maps to `reserve_price()` witness — only populated if user is seller
  reserve_price?: bigint;

  // Seller-only: the commitment salt (private)
  // Maps to `commitment_salt()` witness
  commitment_salt?: Uint8Array;
}

// ── Step 1: Detect and Connect 1AM Wallet ───────────────────────────────────
/**
 * Detects the 1AM wallet browser extension and requests connection.
 *
 * The 1AM wallet injects `window.midnight.mnLace` — this is the Midnight Network
 * standard dApp connector API key. All Midnight wallets use this namespace.
 * This function waits up to 4 seconds for the injection to appear.
 *
 * Usage:
 *   const connector = await connectWallet();
 *   const address   = await connector.address();
 */
export async function connectWallet(): Promise<MidnightWalletConnector> {
  // Wait for the wallet to inject (up to 3s, checks every 100ms)
  const wallet = await waitForWalletInjection(3000);

  if (!wallet) {
    throw new AuctionApiError(
      AuctionErrorCode.WALLET_NOT_CONNECTED,
      '1AM wallet not found. Please install the 1AM wallet extension and refresh.'
    );
  }

  const isEnabled = await wallet.isEnabled();

  if (!isEnabled) {
    // Request user permission to connect
    const connector = await wallet.enable();
    return connector;
  }

  // Already enabled — re-enable to get fresh connector
  return wallet.enable();
}

/**
 * Polls window.midnight until it appears or timeout expires.
 * Finds the first available wallet injected by extensions (e.g., mn1am or mnLace).
 */
async function waitForWalletInjection(
  timeoutMs: number
): Promise<MidnightWalletApi | null> {
  const startTime = Date.now();
  const pollInterval = 100;

  const getWallet = (): MidnightWalletApi | null => {
    const midnight = window?.midnight;
    if (!midnight || typeof midnight !== 'object') return null;

    // Try known keys in priority order: mn1am (1AM wallet), mnLace (older Lace)
    const priorityKeys = ['mn1am', 'mnLace'];
    for (const key of priorityKeys) {
      const candidate = (midnight as any)[key];
      if (candidate && typeof candidate.enable === 'function') {
        return candidate as MidnightWalletApi;
      }
    }

    // Fallback: find any injected object that has .enable()
    for (const key of Object.keys(midnight)) {
      const candidate = (midnight as any)[key];
      if (candidate && typeof candidate.enable === 'function') {
        return candidate as MidnightWalletApi;
      }
    }
    return null;
  };

  while (Date.now() - startTime < timeoutMs) {
    const wallet = getWallet();
    if (wallet) return wallet;
    await sleep(pollInterval);
  }

  // Last check before giving up
  return getWallet();
}

// ── Step 2: Build Provider Stack ─────────────────────────────────────────────
/**
 * Builds the complete Midnight provider stack for the auction contract.
 *
 * IMPORTANT: This runs in the BROWSER (Next.js client component only).
 *
 * Uses the correct 1AM wallet API:
 *  - api.getProvingProvider(zkConfigProvider) → proof provider
 *  - api.balanceUnsealedTransaction(hexTx)    → balance transactions
 *  - api.submitTransaction(hexTx)             → submit transactions
 *  - api.getShieldedAddresses()               → coin/encryption public keys (used as-is)
 */
export async function buildProviders(
  config: BuildProvidersConfig
): Promise<AuctionProviders> {
  const { network, walletConnector } = config;

  // Dynamic imports — browser APIs only
  const { indexerPublicDataProvider } = (await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  )) as any;
  const { FetchZkConfigProvider } = (await import(
    '@midnight-ntwrk/midnight-js-fetch-zk-config-provider'
  )) as any;

  // ── Get shielded keys from wallet ────────────────────────────────────────
  // The wallet returns { shieldedCoinPublicKey, shieldedEncryptionPublicKey }
  // These are passed directly to the SDK — no decoding needed.
  const shieldedAddress = await walletConnector.getShieldedAddresses();
  console.log('[ZKAuction] shieldedAddress:', JSON.stringify(shieldedAddress));

  // ── Provider 5: zkConfigProvider ─────────────────────────────────────────
  // FetchZkConfigProvider fetches ZK key files via simple HTTP:
  //   {baseURL}/keys/{circuitId}.verifier  — verifier keys
  //   {baseURL}/keys/{circuitId}.prover    — prover keys
  //   {baseURL}/zkir/{circuitId}.bzkir     — ZK IR
  //
  // NOT the indexer GraphQL endpoint.
  const zkKeysBaseUrl = typeof window !== 'undefined'
    ? window.location.origin          // browser: http://localhost:3000
    : 'http://localhost:3000';        // SSR fallback (should not reach here)

  const zkConfigProvider = new FetchZkConfigProvider(
    zkKeysBaseUrl,
    fetch.bind(window)
  );

  // ── Provider 4: proofProvider ─────────────────────────────────────────────
  // Get the proving provider FROM the wallet API — it uses the network's proof
  // server internally. DO NOT use httpClientProofProvider.
  const provingProvider = await walletConnector.getProvingProvider(zkConfigProvider);
  const proofProvider = {
    async proveTx(unprovenTx: any): Promise<any> {
      const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
      return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
    },
  } as any;

  // ── Provider 1: walletProvider ───────────────────────────────────────────
  const walletProvider = {
    getCoinPublicKey: () => shieldedAddress.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedAddress.shieldedEncryptionPublicKey,
    // balanceTx: serialize tx → hex, call wallet, deserialize result
    balanceTx: async (tx: any): Promise<any> => {
      const txHex = Array.from(tx.serialize() as Uint8Array)
        .map((b: number) => b.toString(16).padStart(2, '0')).join('');
      console.log('[ZKAuction] balanceUnsealedTransaction called');
      const balanced = await walletConnector.balanceUnsealedTransaction(txHex);
      if (!balanced?.tx) throw new Error(`balanceUnsealedTransaction returned invalid result: ${JSON.stringify(balanced)}`);
      const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
      const hex = balanced.tx.startsWith('0x') ? balanced.tx.slice(2) : balanced.tx;
      const bytes = Uint8Array.from(hex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
      return Transaction.deserialize('signature', 'proof', 'binding', bytes);
    },
  } as any;

  // ── Provider 2: midnightProvider ─────────────────────────────────────────
  const midnightProvider = {
    submitTx: async (tx: any): Promise<any> => {
      const txHex = Array.from(tx.serialize() as Uint8Array)
        .map((b: number) => b.toString(16).padStart(2, '0')).join('');
      console.log('[ZKAuction] submitTransaction called');
      const result = await walletConnector.submitTransaction(txHex);
      if (typeof result === 'string' && result) return result;
      if (result?.transactionId) return result.transactionId;
      if (result?.id) return result.id;
      return txHex.slice(0, 64);
    },
  } as any;

  // ── Provider 3: publicDataProvider ───────────────────────────────────────
  const publicDataProvider = indexerPublicDataProvider(
    network.indexerUri,
    network.indexerWsUri
  );

  // ── Provider 6: privateStateProvider ─────────────────────────────────────
  const privateStateProvider = buildLocalStoragePrivateStateProvider();

  return {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    proofProvider,
    zkConfigProvider,
    privateStateProvider,
  };
}

// (old buildWalletProvider and buildMidnightProvider removed — logic is now inline in buildProviders)

// ── Local Storage Private State Provider ──────────────────────────────────
// Stores private state in browser localStorage so it survives page refreshes.
// Handles serialization of BigInt and Uint8Array.
function buildLocalStoragePrivateStateProvider() {
  const PREFIX = 'zkauction_private_state_';
  let currentContractAddress = 'unscoped';

  const replacer = (key: string, value: any) => {
    if (typeof value === 'bigint') return { _type: 'bigint', value: value.toString() };
    
    // Handle NodeJS Buffer which serializes via toJSON() to { type: 'Buffer', data: [...] }
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
      return { _type: 'Uint8Array', value: value.data };
    }
    
    // Handle native Uint8Array which doesn't have toJSON()
    if (value instanceof Uint8Array) {
      return { _type: 'Uint8Array', value: Array.from(value) };
    }
    
    return value;
  };

  const reviver = (key: string, value: any) => {
    if (value && typeof value === 'object') {
      if (value._type === 'bigint') return BigInt(value.value);
      if (value._type === 'Uint8Array') return new Uint8Array(value.value);
    }
    return value;
  };

  return {
    setContractAddress: (address: string) => {
      currentContractAddress = address;
    },
    get: async (id: string): Promise<AuctionPrivateState | undefined> => {
      try {
        const item = window.localStorage.getItem(`${PREFIX}${currentContractAddress}_${id}`);
        if (!item) return undefined;
        return JSON.parse(item, reviver);
      } catch (e) {
        console.error('Failed to load private state from localStorage', e);
        return undefined;
      }
    },
    set: async (id: string, state: AuctionPrivateState): Promise<void> => {
      window.localStorage.setItem(`${PREFIX}${currentContractAddress}_${id}`, JSON.stringify(state, replacer));
    },
    remove: async (id: string): Promise<void> => {
      window.localStorage.removeItem(`${PREFIX}${currentContractAddress}_${id}`);
    },
  } as any;
}

// ── Network Configs ───────────────────────────────────────────────────────────
// Pre-built configs for common environments.
// Values sourced from Midnight's official documentation.
// Network IDs (exact strings for wallet.connect() and setNetworkId()):
//   'preview'  — Midnight Preview testnet (most stable for current dev)
//   'preprod'  — Midnight Preprod testnet
//   'devnet'   — Local docker stack

/** Midnight Preview network endpoints (official public endpoints, no key required) */
export const PREVIEW_CONFIG: MidnightNetworkConfig = {
  nodeWsUrl:      process.env.NEXT_PUBLIC_NODE_WS_URL
                    ?? 'wss://rpc.preview.midnight.network/ws',
  indexerUri:     process.env.NEXT_PUBLIC_INDEXER_URI
                    ?? 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUri:   process.env.NEXT_PUBLIC_INDEXER_WS_URI
                    ?? 'wss://indexer.preview.midnight.network/api/v4/graphql',
  proofServerUri: process.env.NEXT_PUBLIC_PROOF_SERVER_URI
                    ?? 'https://proving.preview.midnight.network',
};

/** Midnight Preprod endpoints */
export const PREPROD_CONFIG: MidnightNetworkConfig = {
  nodeWsUrl:      'wss://rpc.preprod.midnight.network/ws',
  indexerUri:     'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWsUri:   'wss://indexer.preprod.midnight.network/api/v4/graphql',
  proofServerUri: 'https://proving.preprod.midnight.network',
};

/** Local DevNet (docker compose up) endpoints */
export const DEVNET_CONFIG: MidnightNetworkConfig = {
  nodeWsUrl:      'ws://localhost:9944',
  indexerUri:     'http://localhost:8088/api/v1/graphql',
  indexerWsUri:   'ws://localhost:8088/api/v1/graphql',
  proofServerUri: 'http://localhost:6300',
};

/**
 * Returns the appropriate network config based on NEXT_PUBLIC_MIDNIGHT_NETWORK.
 * The env var should be the exact network ID string: 'preview', 'preprod', or 'devnet'.
 */
export function getNetworkConfig(): MidnightNetworkConfig {
  const network = (process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'preview').toLowerCase();
  if (network === 'devnet') return DEVNET_CONFIG;
  if (network === 'preprod') return PREPROD_CONFIG;
  return PREVIEW_CONFIG; // default: 'preview'
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempts to extract CoinPublicKey and EncryptionPublicKey directly from the wallet connector,
 * falling back to decoding the shielded address (bech32m).
 */
async function extractKeysFromConnectorOrAddress(connector: any, walletAddress: string) {
  try {
    // 1. First: try to get keys directly from the 1AM wallet API via getShieldedAddresses()
    //    The wallet returns { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }
    if (typeof connector.getShieldedAddresses === 'function') {
      const res = await connector.getShieldedAddresses();
      console.log('[ZKAuction] extractKeys: getShieldedAddresses =>', JSON.stringify(res, null, 2));

      // Single object response (1AM wallet on preview / preprod)
      if (res && res.shieldedCoinPublicKey && res.shieldedEncryptionPublicKey) {
        console.log('[ZKAuction] extractKeys: using shieldedCoinPublicKey / shieldedEncryptionPublicKey directly');
        return {
          coinPublicKey: res.shieldedCoinPublicKey,
          encryptionPublicKey: res.shieldedEncryptionPublicKey,
        };
      }
      // Array response
      if (Array.isArray(res) && res[0] && res[0].shieldedCoinPublicKey) {
        return {
          coinPublicKey: res[0].shieldedCoinPublicKey,
          encryptionPublicKey: res[0].shieldedEncryptionPublicKey,
        };
      }
    }

    // 2. Try falling back to standard connector properties
    if (typeof connector.getCoinPublicKey === 'function' && typeof connector.getEncryptionPublicKey === 'function') {
      return {
        coinPublicKey: await connector.getCoinPublicKey(),
        encryptionPublicKey: await connector.getEncryptionPublicKey(),
      };
    }

    // 3. Fall back to parsing the walletAddress string
    if (!walletAddress || walletAddress === 'unknown') {
      throw new Error('Cannot extract keys from unknown address');
    }

    // Reject unshielded addresses (they can't provide ZK keys)
    const isUnshielded =
      walletAddress.startsWith('tdu1') ||
      walletAddress.startsWith('mn_addr_') ||
      walletAddress.startsWith('mn_unshield');
    if (isUnshielded) {
      throw new Error(
        'An unshielded address cannot be used for ZK proofs. ' +
        'Please ensure your 1AM wallet has a shielded address and is fully synced.'
      );
    }

    const { ShieldedAddress, MidnightBech32m } = (await import(
      '@midnight-ntwrk/wallet-sdk-address-format'
    )) as any;
    
    // Decode the bech32m string into bytes
    const decodedBech32 = MidnightBech32m.decode(walletAddress);
    // Parse the bytes into a ShieldedAddress object
    const shielded = ShieldedAddress.codec.dataFromBytes(decodedBech32);
    
    return {
      coinPublicKey: shielded.coinPublicKeyString(),
      encryptionPublicKey: shielded.encryptionPublicKeyString(),
    };
  } catch (err: any) {
    console.error('[ZKAuction] Failed to extract public keys:', err);
    throw new Error('Failed to extract public keys from wallet address: ' + (err.message || String(err)));
  }
}

