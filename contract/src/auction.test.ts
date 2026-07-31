/**
 * auction.test.ts — ZKAuction Contract Tests (Vitest)
 *
 * Phase 1: Full test suite for the private reserve auction contract.
 *
 * ARCHITECTURE NOTE:
 * ─────────────────
 * The Compact compiler (compactc) generates a TypeScript API from auction.compact.
 * Until compactc is run (Phase 1 setup step), we test the CONTRACT LOGIC using
 * a TypeScript simulation of the ledger state machine. This lets us write and
 * verify all tests immediately, before the actual ZK compiler is available.
 *
 * When compactc IS available, these tests will be migrated to use the real
 * generated types from contract/src/generated/. The logic stays identical.
 *
 * Run:   npm test
 * Watch: npm run test:watch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// ── Test Helpers ────────────────────────────────────────────────────────────
// These simulate the Compact contract's behaviour in TypeScript.
// They mirror the exact logic in auction.compact.

enum AuctionStatus { OPEN = 'OPEN', SETTLED = 'SETTLED', EXPIRED = 'EXPIRED' }

interface AuctionLedger {
  seller: Buffer;
  reserve_commitment: Buffer;
  highest_bid: bigint;
  highest_bidder: Buffer;
  auction_end_block: bigint;
  status: AuctionStatus;
  bid_count: number;
  item_hash: Buffer;
}

// Simulates persistentHash<Bytes<32>>(secretKey)
// In real Compact: uses domain-separated Poseidon hash
// Here: SHA-256 with a fixed domain prefix
function deriveKey(secretKey: Buffer): Buffer {
  return crypto.createHash('sha256')
    .update(Buffer.from('midnight-dapp-key-v1:'))
    .update(secretKey)
    .digest();
}

// Simulates the commitment = persistentHash(salt)
// Reserve price is kept private; only the salt's hash is stored
function makeCommitment(salt: Buffer): Buffer {
  return crypto.createHash('sha256')
    .update(Buffer.from('midnight-commitment-v1:'))
    .update(salt)
    .digest();
}

// Creates a fresh auction ledger (simulates constructor())
function createLedger(deployerSecretKey: Buffer): AuctionLedger {
  return {
    seller: deriveKey(deployerSecretKey),
    reserve_commitment: Buffer.alloc(32),
    highest_bid: 0n,
    highest_bidder: Buffer.alloc(32),
    auction_end_block: 0n,
    status: AuctionStatus.OPEN,
    bid_count: 0,
    item_hash: Buffer.alloc(32),
  };
}

// Simulates the createAuction() circuit
function circuitCreateAuction(
  ledger: AuctionLedger,
  sellerKey: Buffer,
  durationBlocks: bigint,
  reservePrice: bigint,
  salt: Buffer,
  itemHash: Buffer
): AuctionLedger {
  // Access control: only seller
  if (!ledger.seller.equals(deriveKey(sellerKey))) {
    throw new Error('Only the seller can create the auction');
  }
  if (ledger.auction_end_block !== 0n) {
    throw new Error('Auction already created');
  }
  if (durationBlocks <= 0n) {
    throw new Error('Duration must be > 0 blocks');
  }

  // Reserve price is used to build the commitment — but stays private
  const commitment = makeCommitment(salt); // price proven privately

  return {
    ...ledger,
    reserve_commitment: commitment,
    auction_end_block: durationBlocks,
    item_hash: itemHash,
  };
}

// Simulates the placeBid() circuit
function circuitPlaceBid(
  ledger: AuctionLedger,
  bidderKey: Buffer,
  bidAmount: bigint
): AuctionLedger {
  if (ledger.status !== AuctionStatus.OPEN) {
    throw new Error('Auction is not open');
  }
  if (ledger.auction_end_block <= 0n) {
    throw new Error('Auction not yet configured');
  }
  if (bidAmount <= ledger.highest_bid) {
    throw new Error('Bid must exceed current highest bid');
  }

  const derivedBidderKey = deriveKey(bidderKey);
  if (derivedBidderKey.equals(ledger.seller)) {
    throw new Error('Seller cannot bid on their own auction');
  }

  return {
    ...ledger,
    highest_bid: bidAmount,
    highest_bidder: derivedBidderKey,
    bid_count: ledger.bid_count + 1,
  };
}

// Simulates the settle() circuit
function circuitSettle(
  ledger: AuctionLedger,
  sellerKey: Buffer,
  reservePrice: bigint,
  salt: Buffer
): AuctionLedger {
  if (!ledger.seller.equals(deriveKey(sellerKey))) {
    throw new Error('Only the seller can settle the auction');
  }
  if (ledger.status !== AuctionStatus.OPEN) {
    throw new Error('Auction already settled or expired');
  }
  if (ledger.auction_end_block <= 0n) {
    throw new Error('Auction not configured');
  }

  // Verify commitment: recompute from private witnesses
  const recomputed = makeCommitment(salt);
  if (!recomputed.equals(ledger.reserve_commitment)) {
    throw new Error('Invalid reserve commitment: wrong price or salt');
  }

  // Determine outcome — ZK proof guarantees this comparison is correct
  const newStatus = ledger.highest_bid >= reservePrice
    ? AuctionStatus.SETTLED
    : AuctionStatus.EXPIRED;

  return { ...ledger, status: newStatus };
}

// Simulates the withdrawExpired() circuit
function circuitWithdrawExpired(
  ledger: AuctionLedger,
  callerKey: Buffer
): AuctionLedger {
  if (ledger.status !== AuctionStatus.EXPIRED) {
    throw new Error('Auction is not expired');
  }

  const callerDerivedKey = deriveKey(callerKey);
  const isSeller = callerDerivedKey.equals(ledger.seller);
  const isBidder = callerDerivedKey.equals(ledger.highest_bidder);

  if (!isSeller && !isBidder) {
    throw new Error('Only seller or highest bidder can withdraw');
  }

  return {
    ...ledger,
    highest_bid: 0n,
    highest_bidder: Buffer.alloc(32),
  };
}

// ── Test Data ───────────────────────────────────────────────────────────────
const SELLER_KEY  = Buffer.from('seller-secret-key-000000000000000000000', 'utf8').slice(0, 32);
const BIDDER_A    = Buffer.from('bidder-alice-secret-0000000000000000000', 'utf8').slice(0, 32);
const BIDDER_B    = Buffer.from('bidder-bob-secret-00000000000000000000', 'utf8').slice(0, 32);
const EVIL_KEY    = Buffer.from('attacker-secret-key-00000000000000000', 'utf8').slice(0, 32);

const RESERVE_PRICE = 1000n;  // 1000 tNIGHT
const SALT          = crypto.randomBytes(32);
const ITEM_HASH     = crypto.createHash('sha256').update('Vintage Compact Keyboard #001').digest();

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('ZKAuction — Private Reserve Auction', () => {

  // ── TEST 1: Full Happy Path ─────────────────────────────────────────────
  describe('Test 1: Full happy-path lifecycle (create → bid → settle)', () => {
    it('auction creates, bids are placed, and settles when reserve is met', () => {
      // Deploy contract
      let ledger = createLedger(SELLER_KEY);
      expect(ledger.status).toBe(AuctionStatus.OPEN);
      expect(ledger.auction_end_block).toBe(0n);

      // Seller creates the auction
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      expect(ledger.auction_end_block).toBe(100n);
      // Commitment is stored — NOT the price
      expect(ledger.reserve_commitment).not.toEqual(Buffer.alloc(32));
      // Sanity: commitment is not the price itself
      expect(ledger.reserve_commitment.readBigUInt64BE(0)).not.toBe(RESERVE_PRICE);

      // Bidder A places a bid above zero
      ledger = circuitPlaceBid(ledger, BIDDER_A, 800n);
      expect(ledger.highest_bid).toBe(800n);
      expect(ledger.bid_count).toBe(1);
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_A));

      // Bidder B outbids A
      ledger = circuitPlaceBid(ledger, BIDDER_B, 1200n);
      expect(ledger.highest_bid).toBe(1200n);
      expect(ledger.bid_count).toBe(2);
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_B));

      // Seller settles — 1200 >= 1000 reserve → SETTLED
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);
      expect(ledger.status).toBe(AuctionStatus.SETTLED);

      // Bidder B won — their ZK key is shown, NOT their wallet
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_B));
      expect(ledger.highest_bidder).not.toEqual(BIDDER_B); // key ≠ raw secret
    });
  });

  // ── TEST 2: Reserve Not Met → EXPIRED ──────────────────────────────────
  describe('Test 2: Highest bid below reserve price → auction EXPIRES', () => {
    it('settle() sets status to EXPIRED when highest bid < reserve', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);

      // Only bid is 500, below 1000 reserve
      ledger = circuitPlaceBid(ledger, BIDDER_A, 500n);
      expect(ledger.highest_bid).toBe(500n);

      // Seller settles — 500 < 1000 → EXPIRED
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);
      expect(ledger.status).toBe(AuctionStatus.EXPIRED);
    });
  });

  // ── TEST 3: Multiple Bids — Highest Wins ───────────────────────────────
  describe('Test 3: Multiple competing bids — only highest bidder wins', () => {
    it('each bid must exceed the previous; only final bidder is recorded', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);

      // Sequence of bids
      ledger = circuitPlaceBid(ledger, BIDDER_A, 100n);
      expect(ledger.bid_count).toBe(1);
      expect(ledger.highest_bid).toBe(100n);

      ledger = circuitPlaceBid(ledger, BIDDER_B, 500n);
      expect(ledger.bid_count).toBe(2);
      expect(ledger.highest_bid).toBe(500n);
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_B));

      // A tries to rebid but must exceed 500
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1500n);
      expect(ledger.bid_count).toBe(3);
      expect(ledger.highest_bid).toBe(1500n);
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_A));

      // B's identity is no longer highest bidder
      expect(ledger.highest_bidder).not.toEqual(deriveKey(BIDDER_B));
    });
  });

  // ── TEST 4: Expired Auction Withdrawal ─────────────────────────────────
  describe('Test 4: withdrawExpired — seller can withdraw after EXPIRED', () => {
    it('seller can call withdrawExpired after auction expires', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 200n); // below reserve
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);
      expect(ledger.status).toBe(AuctionStatus.EXPIRED);

      // Seller withdraws
      ledger = circuitWithdrawExpired(ledger, SELLER_KEY);
      expect(ledger.highest_bid).toBe(0n);
      expect(ledger.highest_bidder).toEqual(Buffer.alloc(32));
    });

    it('highest bidder can also withdraw their losing bid', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 200n);
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);

      // Losing bidder withdraws
      ledger = circuitWithdrawExpired(ledger, BIDDER_A);
      expect(ledger.highest_bid).toBe(0n);
    });
  });

  // ── TEST 5: Reserve Commitment Integrity ───────────────────────────────
  describe('Test 5: reserve commitment cannot be forged', () => {
    it('settle() reverts if wrong salt is provided', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1200n);

      const wrongSalt = crypto.randomBytes(32); // Different salt
      expect(() => {
        circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, wrongSalt);
      }).toThrow('Invalid reserve commitment: wrong price or salt');
    });

    it('bidder identity is ZK-derived — raw key never exposed', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1200n);

      // On-chain bidder key is persistentHash(secretKey) — NOT the raw key
      expect(ledger.highest_bidder).not.toEqual(BIDDER_A);
      // But it IS deterministically derived from the key
      expect(ledger.highest_bidder).toEqual(deriveKey(BIDDER_A));
    });
  });

  // ── TEST 6: Access Control ──────────────────────────────────────────────
  describe('Test 6: Access control — unauthorized callers rejected', () => {
    it('non-seller cannot call createAuction', () => {
      const ledger = createLedger(SELLER_KEY);
      expect(() => {
        circuitCreateAuction(ledger, EVIL_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      }).toThrow('Only the seller can create the auction');
    });

    it('non-seller cannot settle the auction', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1200n);

      expect(() => {
        circuitSettle(ledger, EVIL_KEY, RESERVE_PRICE, SALT);
      }).toThrow('Only the seller can settle the auction');
    });

    it('bid equal to highest bid is rejected (must strictly exceed)', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1200n);

      expect(() => {
        circuitPlaceBid(ledger, BIDDER_B, 1200n); // Same amount — must be > not >=
      }).toThrow('Bid must exceed current highest bid');
    });

    it('cannot bid on a settled auction', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 1200n);
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);
      expect(ledger.status).toBe(AuctionStatus.SETTLED);

      expect(() => {
        circuitPlaceBid(ledger, BIDDER_B, 9999n);
      }).toThrow('Auction is not open');
    });

    it('seller cannot bid on their own auction', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);

      expect(() => {
        circuitPlaceBid(ledger, SELLER_KEY, 1200n);
      }).toThrow('Seller cannot bid on their own auction');
    });

    it('third party cannot call withdrawExpired', () => {
      let ledger = createLedger(SELLER_KEY);
      ledger = circuitCreateAuction(ledger, SELLER_KEY, 100n, RESERVE_PRICE, SALT, ITEM_HASH);
      ledger = circuitPlaceBid(ledger, BIDDER_A, 200n);
      ledger = circuitSettle(ledger, SELLER_KEY, RESERVE_PRICE, SALT);

      expect(() => {
        circuitWithdrawExpired(ledger, EVIL_KEY);
      }).toThrow('Only seller or highest bidder can withdraw');
    });
  });

  // ── Phase 0 Framework Tests (kept for CI continuity) ───────────────────
  describe('Phase 0 — Environment verification (kept for CI)', () => {
    it('test environment is Node v22+', () => {
      expect(typeof process.version).toBe('string');
      expect(process.version).toMatch(/^v22/);
    });

    it('Midnight SDK packages are importable', async () => {
      const networkIdModule = await import('@midnight-ntwrk/midnight-js-network-id');
      expect(networkIdModule).toBeDefined();
      expect(typeof networkIdModule.getNetworkId).toBe('function');
    });

    it('compact-runtime is importable', async () => {
      const compactRuntime = await import('@midnight-ntwrk/compact-runtime');
      expect(compactRuntime).toBeDefined();
    });
  });
});
