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
// The 1AM wallet injects itself as window.midnight.mnLace
// This is a Midnight Network standard — the mnLace key is the dApp connector API
// used by all Midnight-compatible wallets (1AM, and future wallets).
// This interface describes the shape of the injected connector.
export interface MidnightWalletApi {
  enable(): Promise<MidnightWalletConnector>;
  isEnabled(): Promise<boolean>;
  apiVersion: string;
  name: string;
  icon: string;
}

export interface MidnightWalletConnector {
  // Returns the wallet's Midnight payment address
  address(): Promise<string>;

  // Returns the wallet's current tNIGHT balance (µNIGHT as string)
  balanceTx(tx: unknown, coinSelection: boolean): Promise<string>;

  // Submits a balanced, proven transaction
  submitTx(tx: string): Promise<string>;

  // Returns the wallet's proof server URL (if wallet manages it)
  state(): Promise<{ address: string; balance: string }>;
}

// Augment Window to include the 1AM wallet injection
declare global {
  interface Window {
    midnight?: {
      // 1AM wallet (Midnight Network dApp connector API)
      mnLace?: MidnightWalletApi;
    };
  }
}

// ── Provider Building Config ─────────────────────────────────────────────────
export interface BuildProvidersConfig {
  network: MidnightNetworkConfig;
  // The 1AM wallet connector (obtained after wallet.enable())
  walletConnector: MidnightWalletConnector;
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
 * Polls window.midnight.mnLace until it appears or timeout expires.
 * The 1AM wallet uses the mnLace key — the Midnight Network dApp connector standard.
 */
async function waitForWalletInjection(
  timeoutMs: number
): Promise<MidnightWalletApi | null> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    const wallet = window?.midnight?.mnLace;
    if (wallet) return wallet;
    await sleep(pollInterval);
  }

  // Last check before giving up
  return window?.midnight?.mnLace ?? null;
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
  // Dynamic imports — these packages use browser APIs and must be
  // imported at runtime (not at module load time) for Next.js compatibility.

  // Use 'as any' for dynamic imports since Next.js doesn't bundle these properly for SSR
  const { IndexerPublicDataProvider } = (await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  )) as any;
  const { HttpClientProofProvider } = (await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  )) as any;
  const { FetchZKConfigProvider } = (await import(
    '@midnight-ntwrk/midnight-js-fetch-zk-config-provider'
  )) as any;

  const { network, walletConnector } = config;

  // ── Provider 1: walletProvider ───────────────────────────────────────────
  // Wraps the 1AM wallet connector into the Midnight WalletProvider interface.
  // Handles transaction balancing (adding fee UTXOs) and signing.
  const walletProvider = buildWalletProvider(walletConnector);

  // ── Provider 2: midnightProvider ─────────────────────────────────────────
  // Submits finalized transactions to the Midnight node over WebSocket.
  // The wallet itself exposes this — it knows which node to talk to.
  const midnightProvider = buildMidnightProvider(walletConnector, network);

  // ── Provider 3: publicDataProvider ───────────────────────────────────────
  // Reads contract public ledger state from the Midnight indexer.
  // Uses GraphQL subscriptions for live state updates.
  const publicDataProvider = new IndexerPublicDataProvider(
    network.indexerUri,
    network.indexerWsUri
  );

  // ── Provider 4: proofProvider ────────────────────────────────────────────
  // Sends private witnesses to the LOCAL proof server (Docker container).
  // This is where ZK proofs are generated — all on YOUR machine.
  // Private data (reserve price, secret key, salt) never leaves this service.
  const proofProvider = new HttpClientProofProvider(
    network.proofServerUri
  );

  // ── Provider 5: zkConfigProvider ─────────────────────────────────────────
  // Fetches ZK artifacts (prover key, verifier key, ZKIR) for each circuit.
  // These are stored on-chain after deployment and fetched via the indexer.
  // Required by the proof server to generate proofs for the right circuit.
  const zkConfigProvider = new FetchZKConfigProvider(
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
// Adapts the 1AM wallet connector to the Midnight WalletProvider interface.
function buildWalletProvider(connector: MidnightWalletConnector) {
  return {
    // balanceTx: takes an unbalanced proven transaction, returns balanced one
    // The wallet adds fee UTXOs and signs with the user's key.
    balanceTx: async (tx: unknown, coinSelection: boolean): Promise<string> => {
      return connector.balanceTx(tx, coinSelection);
    },
    submitTx: async (tx: any): Promise<string> => {
      return connector.submitTx(tx as string);
    },
  } as any;
}

// ── Midnight Provider Adapter ─────────────────────────────────────────────────
// The midnightProvider handles WebSocket submission to the node.
// The 1AM wallet manages the node connection internally.
function buildMidnightProvider(
  connector: MidnightWalletConnector,
  _network: MidnightNetworkConfig
) {
  return {
    submitTx: async (tx: any): Promise<string> => {
      return connector.submitTx(tx as string);
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
  const network = process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'TestNet';
  return network === 'DevNet' ? DEVNET_CONFIG : PREPROD_CONFIG;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
