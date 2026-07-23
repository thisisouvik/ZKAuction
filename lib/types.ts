/**
 * lib/types.ts — Shared TypeScript Types for ZKAuction
 *
 * These types mirror the Compact contract's ledger state and provide
 * a clean, strongly-typed interface for the frontend and API layer.
 *
 * IMPORTANT for first-timers:
 * ───────────────────────────
 * The Compact compiler (compactc) generates its own TypeScript types from
 * auction.compact. Those generated types are the source of truth at runtime.
 * These types here are for the API layer and UI — they describe the DECODED
 * ledger state in a human-readable form after reading from the chain.
 */

// ── Auction Status ───────────────────────────────────────────────────────────
// Mirrors the AuctionStatus enum in auction.compact
export enum AuctionStatus {
  OPEN     = 'OPEN',
  SETTLED  = 'SETTLED',
  EXPIRED  = 'EXPIRED',
}

// ── On-Chain Ledger State ────────────────────────────────────────────────────
// What an observer CAN read from the chain.
// Note: reserve_commitment is a hash — NOT the price. Never the price.
export interface AuctionState {
  // ZK-derived seller identity (not the real wallet address)
  seller: string;

  // Hash of (salt) used in commitment. The reserve_price is HIDDEN.
  // Format: hex string of 32 bytes
  reserve_commitment: string;

  // Current top bid in tNIGHT (1 tNIGHT = 1_000_000 µNIGHT)
  highest_bid: bigint;

  // ZK-derived identity of the top bidder (NOT their wallet address)
  highest_bidder: string;

  // Block number at which bidding closes
  auction_end_block: bigint;

  // Current lifecycle phase
  status: AuctionStatus;

  // Total number of bids placed
  bid_count: number;

  // SHA-256 hash of the item description string
  item_hash: string;
}

// ── Seller's Private Config (stored locally ONLY — never on-chain) ───────────
// The seller creates this when calling createAuction().
// It must be saved locally (IndexedDB / local storage) so the seller can
// call settle() later with the same values.
export interface SellerPrivateConfig {
  // The actual reserve price (private — NEVER sent to chain)
  reserve_price: bigint;

  // The salt used when creating the commitment (private — never on-chain)
  commitment_salt: string; // hex string of 32 bytes

  // The contract address this config belongs to
  contract_address: string;

  // When the auction was created (for local display)
  created_at: number; // Unix timestamp ms
}

// ── Create Auction Parameters (public inputs from UI) ────────────────────────
export interface CreateAuctionParams {
  // How many blocks the auction should run
  // Midnight Preprod: ~5 seconds per block, so 100 blocks ≈ 8 minutes
  duration_blocks: bigint;

  // The reserve price (private witness — only you know this)
  reserve_price: bigint;

  // Item description (the actual text — will be hashed for on-chain storage)
  item_description: string;
}

// ── Place Bid Parameters ─────────────────────────────────────────────────────
export interface PlaceBidParams {
  // The bid amount in tNIGHT
  amount: bigint;

  // The deployed contract address to bid on
  contract_address: string;
}

// ── Transaction Result ───────────────────────────────────────────────────────
// Returned after any successful circuit call
export interface TxResult {
  // Transaction hash on Midnight chain
  txHash: string;

  // Block height where it was included
  blockHeight: number;

  // Human-readable timestamp
  timestamp: number;

  // The updated auction state after the transaction
  newState: AuctionState;
}

// ── Provider Configuration ───────────────────────────────────────────────────
// Used by providers.ts to set up the Midnight SDK stack
export interface MidnightNetworkConfig {
  // Midnight node WebSocket URL (wss://...)
  nodeWsUrl: string;

  // Indexer GraphQL HTTP URL
  indexerUri: string;

  // Indexer GraphQL WebSocket URL (for subscriptions)
  indexerWsUri: string;

  // Proof server HTTP URL (http://localhost:6300 for local, https://... for Preprod)
  proofServerUri: string;
}

// ── Wallet Connection State ──────────────────────────────────────────────────
export interface WalletState {
  // Whether the 1AM wallet is connected
  connected: boolean;

  // The wallet's Midnight address (NOT the ZK-derived key — this is the payment address)
  address?: string;

  // tNIGHT balance in µNIGHT
  balance?: bigint;
}

// ── API Error Types ──────────────────────────────────────────────────────────
export class AuctionApiError extends Error {
  constructor(
    public readonly code: AuctionErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AuctionApiError';
  }
}

export enum AuctionErrorCode {
  WALLET_NOT_CONNECTED    = 'WALLET_NOT_CONNECTED',
  PROVIDERS_NOT_READY     = 'PROVIDERS_NOT_READY',
  CONTRACT_NOT_FOUND      = 'CONTRACT_NOT_FOUND',
  CIRCUIT_CALL_FAILED     = 'CIRCUIT_CALL_FAILED',
  INVALID_STATE           = 'INVALID_STATE',
  COMMITMENT_MISMATCH     = 'COMMITMENT_MISMATCH',
  PROOF_GENERATION_FAILED = 'PROOF_GENERATION_FAILED',
  NETWORK_ERROR           = 'NETWORK_ERROR',
}
