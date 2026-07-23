'use client';

/**
 * app/page.tsx — ZKAuction Main Page
 *
 * This is the single-page application for the private reserve auction dApp.
 *
 * Architecture:
 * ─────────────
 *  1. useWallet() — manages 1AM wallet connection state
 *  2. AuctionAPI  — created once wallet is connected, wraps all circuit calls
 *  3. AuctionCard — displays live state for any known contract address
 *  4. Modals      — CreateAuctionModal, BidModal (shown when user clicks actions)
 *
 * Privacy Model:
 * ──────────────
 *  VISIBLE on-chain:  highest_bid, highest_bidder (ZK key), status, commitment hash
 *  HIDDEN:            reserve_price, real wallet addresses, who bid what
 */

import { useState, useCallback, useRef } from 'react';
import { useWallet }                    from '@/hooks/useWallet';
import { ToastProvider, useToast }      from '@/components/ToastProvider';
import { Navbar }                       from '@/components/Navbar';
import { AuctionCard }                  from '@/components/AuctionCard';
import { CreateAuctionModal, type CreateAuctionFormData } from '@/components/CreateAuctionModal';
import { BidModal }                     from '@/components/BidModal';
import type { AuctionState }            from '@/lib/types';
import { AuctionStatus }                from '@/lib/types';

// ─── Demo auction state (used when wallet not connected or contract not deployed) ──
// This lets you see the full UI immediately without any blockchain setup.
const DEMO_AUCTION: AuctionState = {
  seller:             'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  reserve_commitment: 'ff8a2c4e91b03d7f5a64c2187e39d501b84a96f0c3e27d1a94b580e6c2f1793d',
  highest_bid:        1_200_000n, // 1.2 tNIGHT
  highest_bidder:     'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
  auction_end_block:  99250n,
  status:             AuctionStatus.OPEN,
  bid_count:          3,
  item_hash:          '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
};

const DEMO_ADDRESS = 'mn1qzka2uc3xs8dkp9f0l3m7h6a4n8s2vr7jq5e1t';

// ─── Root page (wrapped in providers) ────────────────────────────────────────
export default function Home() {
  return (
    <ToastProvider>
      <AuctionPage />
    </ToastProvider>
  );
}

// ─── Main page content ────────────────────────────────────────────────────────
function AuctionPage() {
  const wallet  = useWallet();
  const toast   = useToast();

  // API instance created once wallet is connected
  const apiRef  = useRef<any>(null);

  // Auctions the user has deployed or connected to
  const [auctions, setAuctions]   = useState<Array<{ address: string; state: AuctionState }>>([
    { address: DEMO_ADDRESS, state: DEMO_AUCTION },
  ]);
  const [lookupAddress, setLookupAddress] = useState('');

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [bidTarget, setBidTarget]   = useState<{ address: string; state: AuctionState } | null>(null);

  // Pending state per action
  const [pendingCreate, setPendingCreate]   = useState(false);
  const [pendingBid, setPendingBid]         = useState(false);
  const [pendingSettle, setPendingSettle]   = useState<string | null>(null);
  const [pendingWithdraw, setPendingWithdraw] = useState<string | null>(null);

  // ── Initialize AuctionAPI when wallet connects ─────────────────────────────
  const ensureApi = useCallback(async () => {
    if (apiRef.current) return apiRef.current;
    if (!wallet.connector) {
      toast.error('Wallet not connected', 'Please connect your 1AM wallet first.');
      return null;
    }
    try {
      const { AuctionAPI } = await import('@/lib/auction-api');
      apiRef.current = await AuctionAPI.connect(wallet.connector);
      return apiRef.current;
    } catch (err) {
      toast.error('API initialization failed', err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [wallet.connector, toast]);

  // ── Create auction ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(async (data: CreateAuctionFormData) => {
    setPendingCreate(true);
    try {
      const api = await ensureApi();
      if (!api) return;

      const address = await api.deploy({
        duration_blocks:  data.durationBlocks,
        reserve_price:    data.reservePrice,
        item_description: data.itemDescription,
      });

      const state = await api.getState(address);
      setAuctions(prev => [...prev, { address, state }]);
      setShowCreate(false);
      toast.success('Auction deployed! 🎉', `Contract: ${address.slice(0, 20)}…`);
    } catch (err) {
      toast.error('Deploy failed', err instanceof Error ? err.message : String(err));
    } finally {
      setPendingCreate(false);
    }
  }, [ensureApi, toast]);

  // ── Place bid ──────────────────────────────────────────────────────────────
  const handleBid = useCallback(async (amountMicro: bigint) => {
    if (!bidTarget) return;
    setPendingBid(true);
    try {
      const api = await ensureApi();
      if (!api) return;

      const result = await api.placeBid({
        amount:           amountMicro,
        contract_address: bidTarget.address,
      });

      // Update local state with new auction state
      setAuctions(prev =>
        prev.map(a => a.address === bidTarget.address ? { ...a, state: result.newState } : a)
      );
      setBidTarget(null);
      toast.success('Bid placed! ✅', `Tx: ${result.txHash.slice(0, 16)}…`);
    } catch (err) {
      toast.error('Bid failed', err instanceof Error ? err.message : String(err));
    } finally {
      setPendingBid(false);
    }
  }, [bidTarget, ensureApi, toast]);

  // ── Settle ─────────────────────────────────────────────────────────────────
  const handleSettle = useCallback(async (address: string) => {
    setPendingSettle(address);
    try {
      const api = await ensureApi();
      if (!api) return;

      const result = await api.settle(address);
      setAuctions(prev =>
        prev.map(a => a.address === address ? { ...a, state: result.newState } : a)
      );

      if (result.newState.status === AuctionStatus.SETTLED) {
        toast.success('Auction settled! Reserve was met 🎉');
      } else {
        toast.info('Auction expired — reserve was not met.');
      }
    } catch (err) {
      toast.error('Settle failed', err instanceof Error ? err.message : String(err));
    } finally {
      setPendingSettle(null);
    }
  }, [ensureApi, toast]);

  // ── Withdraw ───────────────────────────────────────────────────────────────
  const handleWithdraw = useCallback(async (address: string) => {
    setPendingWithdraw(address);
    try {
      const api = await ensureApi();
      if (!api) return;

      const result = await api.withdrawExpired(address);
      setAuctions(prev =>
        prev.map(a => a.address === address ? { ...a, state: result.newState } : a)
      );
      toast.info('Withdrawal complete.');
    } catch (err) {
      toast.error('Withdraw failed', err instanceof Error ? err.message : String(err));
    } finally {
      setPendingWithdraw(null);
    }
  }, [ensureApi, toast]);

  // ── Load auction by address ────────────────────────────────────────────────
  const handleLookup = useCallback(async () => {
    if (!lookupAddress.trim()) return;
    try {
      const api = await ensureApi();
      if (!api) return;

      const state = await api.getState(lookupAddress.trim());
      const existing = auctions.find(a => a.address === lookupAddress.trim());
      if (!existing) {
        setAuctions(prev => [...prev, { address: lookupAddress.trim(), state }]);
        toast.success('Auction loaded!');
      } else {
        setAuctions(prev =>
          prev.map(a => a.address === lookupAddress.trim() ? { ...a, state } : a)
        );
        toast.info('Auction state refreshed.');
      }
      setLookupAddress('');
    } catch (err) {
      toast.error('Lookup failed', err instanceof Error ? err.message : String(err));
    }
  }, [lookupAddress, auctions, ensureApi, toast]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
      {/* ── Navigation ───────────────────────────────────────────────── */}
      <Navbar wallet={wallet} />

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1200, margin: '0 auto', width: '100%', padding: '48px 24px' }}>

        {/* Hero Section */}
        <section style={{ textAlign: 'center', marginBottom: 64 }} aria-labelledby="hero-title">
          <div
            className="badge badge-purple fade-up"
            style={{ display: 'inline-flex', marginBottom: 20, fontSize: 12 }}
          >
            <span className="pulse-dot" />
            Live on Midnight Preprod
          </div>

          <h1
            id="hero-title"
            className="fade-up stagger-1"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(36px, 6vw, 72px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              marginBottom: 20,
            }}
          >
            Private Reserve
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #a78bfa 0%, #22d3ee 60%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Auction Protocol
            </span>
          </h1>

          <p
            className="fade-up stagger-2"
            style={{ fontSize: 18, color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.7 }}
          >
            Reserve prices are hidden by ZK proofs. Bidder identities are cryptographically derived.
            Nothing sensitive ever touches the chain.
          </p>

          {/* CTA buttons */}
          <div className="fade-up stagger-3" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {wallet.isConnected ? (
              <button
                id="create-auction-btn"
                className="btn btn-primary"
                onClick={() => setShowCreate(true)}
                style={{ fontSize: 16, padding: '14px 28px' }}
              >
                <PlusIcon />
                Create Private Auction
              </button>
            ) : (
              <button
                id="hero-connect-btn"
                className="btn btn-primary"
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
                style={{ fontSize: 16, padding: '14px 28px' }}
              >
                {wallet.isConnecting ? <><span className="spinner" />Connecting…</> : <>Connect 1AM Wallet</>}
              </button>
            )}
            <a href="#privacy" className="btn btn-ghost" style={{ fontSize: 16, padding: '14px 28px' }}>
              View Privacy Model
            </a>
          </div>

          {/* Wallet error */}
          {wallet.error && (
            <div
              style={{
                marginTop: 20,
                padding: '12px 20px',
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 10,
                color: 'var(--red-400)',
                fontSize: 14,
                maxWidth: 500,
                margin: '20px auto 0',
                textAlign: 'left',
              }}
              role="alert"
            >
              ⚠️ {wallet.error}
            </div>
          )}
        </section>

        {/* Stats bar */}
        <section
          className="fade-up stagger-4"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 56 }}
          aria-label="Protocol statistics"
        >
          <div className="stat-card">
            <div className="stat-label">Active Auctions</div>
            <div className="stat-value">{auctions.filter(a => a.state.status === AuctionStatus.OPEN).length}</div>
            <div className="stat-sub">On Midnight Preprod</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Bids</div>
            <div className="stat-value">{auctions.reduce((s, a) => s + a.state.bid_count, 0)}</div>
            <div className="stat-sub">ZK-proven, private</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Privacy Guarantee</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--green-400)' }}>100%</div>
            <div className="stat-sub">Reserve prices hidden</div>
          </div>
        </section>

        {/* Auction lookup bar */}
        <section id="auctions" style={{ marginBottom: 40 }} aria-label="Load auction by address">
          <div style={{ display: 'flex', gap: 10, maxWidth: 680 }}>
            <input
              id="auction-address-input"
              className="input input-mono"
              placeholder="Paste a contract address to load an auction…"
              value={lookupAddress}
              onChange={e => setLookupAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
            />
            <button
              id="load-auction-btn"
              className="btn btn-ghost"
              onClick={handleLookup}
              style={{ flexShrink: 0 }}
            >
              Load
            </button>
          </div>
        </section>

        {/* Auctions grid */}
        <section aria-label="Active auctions" style={{ marginBottom: 80 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 24 }}>
            {auctions.map(({ address, state }) => (
              <AuctionCard
                key={address}
                state={state}
                contractAddress={address}
                isSeller={wallet.isConnected && state.seller.length > 0}
                onBid={() => setBidTarget({ address, state })}
                onSettle={() => handleSettle(address)}
                onWithdraw={() => handleWithdraw(address)}
                isActionPending={
                  pendingSettle === address ||
                  pendingWithdraw === address ||
                  (pendingBid && bidTarget?.address === address)
                }
              />
            ))}
          </div>
        </section>

        {/* ── Privacy Model Section ─────────────────────────────────── */}
        <section
          id="privacy"
          style={{ maxWidth: 900, margin: '0 auto 80px' }}
          aria-labelledby="privacy-heading"
        >
          <div className="divider" />
          <h2
            id="privacy-heading"
            style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-display)', textAlign: 'center', marginBottom: 8 }}
          >
            Privacy Model
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 40, fontSize: 16 }}>
            What an observer CAN and CANNOT learn from the public chain
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Visible column */}
            <div className="glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--green-400)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>👁</span> Visible On-Chain
              </h3>
              {[
                ['reserve_commitment', 'A hash of (price, salt). Proves commitment without revealing price.'],
                ['highest_bid', 'The current leading bid amount, visible so others can outbid.'],
                ['highest_bidder', 'A ZK-derived key — NOT the real wallet address.'],
                ['status', 'OPEN / SETTLED / EXPIRED — the auction lifecycle phase.'],
                ['auction_end_block', 'Block number when bidding closes.'],
                ['bid_count', 'How many bids have been placed.'],
                ['item_hash', 'SHA-256 of the item description. Verifiable off-chain.'],
              ].map(([key, desc]) => (
                <PrivacyItem key={key} icon="✅" name={key} desc={desc} variant="visible" />
              ))}
            </div>

            {/* Hidden column */}
            <div className="glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--purple-400)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔒</span> Hidden by ZK Proofs
              </h3>
              {[
                ['reserve_price', 'Never stored on-chain. Proven privately using ZK circuits.'],
                ['commitment_salt', 'Random 32-byte salt that prevents brute-force of the commitment.'],
                ['real wallet addresses', 'Bidders appear as persistentHash(secretKey), not their address.'],
                ['who placed which bid', 'Each bid proves validity without linking to a wallet.'],
                ['seller private key', 'Used in ZK proof generation — stays on device.'],
                ['bid history correlation', 'Different contracts produce different ZK keys for the same wallet.'],
              ].map(([key, desc]) => (
                <PrivacyItem key={key} icon="🔒" name={key} desc={desc} variant="hidden" />
              ))}
            </div>
          </div>

          {/* How it works */}
          <div
            className="glass"
            style={{ padding: 32, marginTop: 24 }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, fontFamily: 'var(--font-display)' }}>
              How ZK Reserve Price Commitment Works
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                {
                  step: '1. Commit',
                  icon: '🔐',
                  desc: 'Seller computes commitment = hash(reserve_price, random_salt). Only the hash goes on-chain.',
                },
                {
                  step: '2. Bid',
                  icon: '💸',
                  desc: 'Bidders submit bids publicly. The reserve remains hidden. ZK proves bid > 0.',
                },
                {
                  step: '3. Settle',
                  icon: '⚖️',
                  desc: 'Seller provides (reserve_price, salt) as private ZK witnesses. Circuit proves bid ≥ reserve without revealing the price.',
                },
              ].map(({ step, icon, desc }) => (
                <div key={step} style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple-400)', marginBottom: 6 }}>{step}</div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ textAlign: 'center', padding: '24px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            ZKAuction — Built on{' '}
            <a href="https://midnight.network" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--purple-400)', textDecoration: 'none' }}>
              Midnight Network
            </a>
            {' '}· Zero-knowledge private reserve auctions · Open source
          </p>
        </footer>
      </main>

      {/* ── Modals ────────────────────────────────────────────────── */}
      <CreateAuctionModal
        isOpen={showCreate}
        isPending={pendingCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      {bidTarget && (
        <BidModal
          isOpen={true}
          isPending={pendingBid}
          state={bidTarget.state}
          contractAddress={bidTarget.address}
          onClose={() => setBidTarget(null)}
          onBid={handleBid}
        />
      )}
    </div>
  );
}

// ── Utility sub-components ────────────────────────────────────────────────────

function PrivacyItem({
  icon, name, desc, variant,
}: {
  icon: string;
  name: string;
  desc: string;
  variant: 'visible' | 'hidden';
}) {
  const color = variant === 'visible' ? 'var(--green-400)' : 'var(--purple-400)';
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <div>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, fontWeight: 600 }}>{name}</code>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 2 }}>{desc}</p>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18 }}>
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  );
}
