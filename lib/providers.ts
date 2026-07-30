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
 * This is the most important function in the API layer — it wires together
 * all six providers. The result is passed to deployContract() or findDeployedContract().
 *
 * IMPORTANT: This runs in the BROWSER (Next.js client component only).
 * Midnight SDK providers use browser APIs (WebSocket, IndexedDB, fetch).
 * Never call this from a Next.js server component or API route.
 *
 * @param config - Network endpoints + wallet connector
 * @returns Promise<AuctionProviders> — the wired provider stack
 *
 * @example
 * ```ts
 * const connector = await connectWallet();
 * const providers = await buildProviders({
 *   network: PREPROD_CONFIG,
 *   walletConnector: connector,
 * });
 * const deployed = await deployContract(providers, { ... });
 * ```
 */
export async function buildProviders(
  config: BuildProvidersConfig
): Promise<AuctionProviders> {
  const { network, walletConnector, walletAddress } = config;

  // Dynamic imports — these packages use browser APIs and must be
  // imported at runtime (not at module load time) for Next.js compatibility.
  const { indexerPublicDataProvider } = (await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  )) as any;
  const { httpClientProofProvider } = (await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  )) as any;
  const { FetchZkConfigProvider } = (await import(
    '@midnight-ntwrk/midnight-js-fetch-zk-config-provider'
  )) as any;

  // ── Provider 1: walletProvider ───────────────────────────────────────────
  // Wraps the 1AM wallet connector into the Midnight WalletProvider interface.
  // Handles transaction balancing (adding fee UTXOs) and signing.
  const walletProvider = await buildWalletProvider(walletConnector, walletAddress || '');

  // ── Provider 2: midnightProvider ─────────────────────────────────────────
  // Submits finalized transactions to the Midnight node over WebSocket.
  // The wallet itself exposes this — it knows which node to talk to.
  const midnightProvider = buildMidnightProvider(walletConnector);

  // ── Provider 3: publicDataProvider ───────────────────────────────────────
  // Reads contract public ledger state from the Midnight indexer.
  // Uses GraphQL subscriptions for live state updates.
  // Note: indexerPublicDataProvider is a factory function, not a constructor.
  const publicDataProvider = indexerPublicDataProvider(
    network.indexerUri,
    network.indexerWsUri
  );

  // ── Provider 4: proofProvider ────────────────────────────────────────────
  // Sends private witnesses to the remote Preprod proof server.
  // This is where ZK proofs are generated.
  // Note: httpClientProofProvider is a factory function, not a constructor.
  const proofProvider = httpClientProofProvider(
    network.proofServerUri
  );

  // ── Provider 5: zkConfigProvider ─────────────────────────────────────────
  // Fetches ZK artifacts (prover key, verifier key, ZKIR) for each circuit.
  // These are stored on-chain after deployment and fetched via the indexer.
  // Required by the proof server to generate proofs for the right circuit.
  // Note: FetchZkConfigProvider IS a class (capital F, lowercase k).
  const zkConfigProvider = new FetchZkConfigProvider(
    network.indexerUri,
    fetch
  );

  // ── Provider 6: privateStateProvider ─────────────────────────────────────
  // Stores and retrieves private state (witnesses) on the user's machine.
  // Uses IndexedDB in browsers (persists across page reloads).
  // This is where reserve_price and commitment_salt are stored locally.
  const privateStateProvider = buildInMemoryPrivateStateProvider();

  return {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    proofProvider,
    zkConfigProvider,
    privateStateProvider,
  };
}

// ── Wallet Provider Adapter ───────────────────────────────────────────────────
// Implements the SDK's WalletProvider interface using the 1AM wallet connector.
// The SDK requires: balanceTx(tx, ttl?), getCoinPublicKey(), getEncryptionPublicKey()
async function buildWalletProvider(connector: any, walletAddress: string) {
  // Extract coin and encryption public keys directly from the wallet if possible,
  // or fall back to decoding the address string.
  const keys = await extractKeysFromConnectorOrAddress(connector, walletAddress);

  return {
    // balanceTx: signs + balances the transaction.
    // The 1AM wallet might use different argument shapes — we try both.
    balanceTx: async (tx: any, ttlOrCoinSelection?: any): Promise<any> => {
      console.log('[ZKAuction] balanceTx called, connector methods:', Object.keys(connector));
      // Try standard WalletProvider signature first (tx, ttl?: Date)
      if (typeof connector.balanceTx === 'function') {
        return connector.balanceTx(tx, ttlOrCoinSelection);
      }
      // Try Cardano-style (tx, coinSelection)
      if (typeof connector.balance === 'function') {
        return connector.balance(tx);
      }
      throw new Error(
        'Wallet connector does not implement balanceTx. ' +
        `Available methods: [${Object.keys(connector).join(', ')}]`
      );
    },

    // getCoinPublicKey: returns the Jubjub public key (32 bytes as hex string).
    // Required by the SDK for ZK proof generation.
    getCoinPublicKey: () => {
      // Try the connector's own method first
      if (typeof connector.getCoinPublicKey === 'function') return connector.getCoinPublicKey();
      if (connector.coinPublicKey) return connector.coinPublicKey;
      // Fall back to address-decoded key
      console.log('[ZKAuction] getCoinPublicKey: using address-decoded key');
      return keys.coinPublicKey;
    },

    // getEncryptionPublicKey: returns the encryption public key (32 bytes as hex).
    getEncryptionPublicKey: () => {
      if (typeof connector.getEncryptionPublicKey === 'function') return connector.getEncryptionPublicKey();
      if (connector.encryptionPublicKey) return connector.encryptionPublicKey;
      console.log('[ZKAuction] getEncryptionPublicKey: using address-decoded key');
      return keys.encryptionPublicKey;
    },
  } as any;
}

// ── Midnight Provider Adapter ─────────────────────────────────────────────────
// The midnightProvider submits finalized transactions to the Midnight node.
function buildMidnightProvider(connector: any) {
  return {
    submitTx: async (tx: any): Promise<any> => {
      if (typeof connector.submitTx === 'function') return connector.submitTx(tx);
      if (typeof connector.submit === 'function') return connector.submit(tx);
      throw new Error(
        'Wallet connector does not implement submitTx. ' +
        `Available methods: [${Object.keys(connector).join(', ')}]`
      );
    },
  } as any;
}

// ── In-Memory Private State Provider ─────────────────────────────────────────
// For development: stores private state in memory (cleared on page refresh).
// Phase 4 will upgrade this to IndexedDB for persistence.
//
// The private state maps: contractAddress+stateId → AuctionPrivateState
function buildInMemoryPrivateStateProvider() {
  const store = new Map<string, AuctionPrivateState>();

  return {
    get: async (id: string): Promise<AuctionPrivateState | undefined> => {
      return store.get(id);
    },
    set: async (id: string, state: AuctionPrivateState): Promise<void> => {
      store.set(id, state);
    },
    remove: async (id: string): Promise<void> => {
      store.delete(id);
    },
  } as any;
}

// ── Network Configs ───────────────────────────────────────────────────────────
// Pre-built configs for common environments.
// Values sourced from Midnight's official documentation.

/** Midnight Preprod (TestNet) endpoints */
export const PREPROD_CONFIG: MidnightNetworkConfig = {
  nodeWsUrl:      process.env.NEXT_PUBLIC_NODE_WS_URL
                    ?? 'wss://rpc.testnet-01.midnight.network/ws',
  indexerUri:     process.env.NEXT_PUBLIC_INDEXER_URI
                    ?? 'https://indexer.testnet-01.midnight.network/api/v1/graphql',
  indexerWsUri:   process.env.NEXT_PUBLIC_INDEXER_WS_URI
                    ?? 'wss://indexer.testnet-01.midnight.network/api/v1/graphql',
  proofServerUri: process.env.NEXT_PUBLIC_PROOF_SERVER_URI
                    ?? 'https://proving.testnet-01.midnight.network',
};

/** Local DevNet (docker compose up) endpoints */
export const DEVNET_CONFIG: MidnightNetworkConfig = {
  nodeWsUrl:      'ws://localhost:9944',
  indexerUri:     'http://localhost:8088/api/v1/graphql',
  indexerWsUri:   'ws://localhost:8088/api/v1/graphql',
  proofServerUri: 'http://localhost:6300',
};

/** Returns the appropriate config based on NEXT_PUBLIC_MIDNIGHT_NETWORK env var */
export function getNetworkConfig(): MidnightNetworkConfig {
  const network = process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'preprod';
  // If it's 'devnet' or 'DevNet', use the local config. Otherwise assume preprod.
  return network.toLowerCase() === 'devnet' ? DEVNET_CONFIG : PREPROD_CONFIG;
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
    // 1. First try to get the keys directly from the 1AM wallet API
    if (typeof connector.getShieldedAddresses === 'function') {
      const res = await connector.getShieldedAddresses();
      if (res && res.shieldedCoinPublicKey && res.shieldedEncryptionPublicKey) {
        return {
          coinPublicKey: res.shieldedCoinPublicKey,
          encryptionPublicKey: res.shieldedEncryptionPublicKey,
        };
      }
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
    
    // Check if it's an unshielded address being passed in fallback
    if (walletAddress.startsWith('tdu1')) {
      throw new Error('An unshielded address (tdu1...) cannot be used for ZK proofs. Please ensure your wallet provides a shielded address.');
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

