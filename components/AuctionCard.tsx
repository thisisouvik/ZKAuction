'use client';

/**
 * components/AuctionCard.tsx
 * Displays a single auction item with its live state.
 * Shows the ZK privacy model inline — what's visible, what's hidden.
 */

import type { AuctionState } from '@/lib/types';
import { AuctionStatus } from '@/lib/types';

interface AuctionCardProps {
  state: AuctionState;
  contractAddress: string;
  /** True when the current user is the seller of this auction */
  isSeller?: boolean;
  /** Called when user wants to place a bid */
  onBid?: () => void;
  /** Called when seller wants to settle */
  onSettle?: () => void;
  /** Called when either party wants to withdraw after expiry */
  onWithdraw?: () => void;
  /** Loading state for action buttons */
  isActionPending?: boolean;
}

export function AuctionCard({
  state,
  contractAddress,
  isSeller = false,
  onBid,
  onSettle,
  onWithdraw,
  isActionPending = false,
}: AuctionCardProps) {
  const isOpen     = state.status === AuctionStatus.OPEN;
  const isSettled  = state.status === AuctionStatus.SETTLED;
  const isExpired  = state.status === AuctionStatus.EXPIRED;

  // Format tNIGHT from bigint (assuming raw units = µNIGHT, 1 NIGHT = 1_000_000 µNIGHT)
  const formatNight = (raw: bigint) => {
    if (raw === 0n) return '—';
    const night = Number(raw) / 1_000_000;
    return `${night.toFixed(2)} tNIGHT`;
  };

  // Truncate a hex key for display
  const truncHex = (hex: string) =>
    hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;

  return (
    <article
      className="glass glass-hover fade-up"
      style={{ padding: 28, borderRadius: 18, position: 'relative', overflow: 'hidden' }}
      aria-label={`Auction item, status: ${state.status}`}
    >
      {/* Subtle top glow bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: isSettled
            ? 'linear-gradient(90deg, #4ade80, #22d3ee)'
            : isExpired
            ? 'linear-gradient(90deg, #f87171, #fb923c)'
            : 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
        }}
      />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <StatusBadge status={state.status} />
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 700,
              marginTop: 10,
              color: 'var(--text-primary)',
            }}
          >
            Auction Item
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            {contractAddress.slice(0, 20)}…
          </p>
        </div>

        {/* Bid count badge */}
        <div style={{ textAlign: 'right' }}>
          <span className="badge badge-purple">
            <BidIcon />
            {state.bid_count} bid{state.bid_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* Highest bid */}
        <div className="stat-card">
          <div className="stat-label">Highest Bid</div>
          <div
            className="stat-value"
            style={{
              background: 'linear-gradient(135deg, #a78bfa, #22d3ee)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontSize: 22,
            }}
          >
            {formatNight(state.highest_bid)}
          </div>
          {state.highest_bid > 0n && (
            <div className="stat-sub" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              🔑 ZK Winner ID: {truncHex(state.highest_bidder)}
            </div>
          )}
        </div>

        {/* Reserve price */}
        <div className="stat-card">
          <div className="stat-label">Reserve Price</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <LockIcon />
            <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--purple-400)' }}>
              Hidden
            </span>
          </div>
          <div className="stat-sub" style={{ marginTop: 6 }}>
            Commitment on-chain only
          </div>
        </div>
      </div>

      {/* ── Block info ── */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 22,
          flexWrap: 'wrap',
        }}
      >
        <InfoChip label="Closes at Block" value={state.auction_end_block.toString()} />
        <InfoChip label="Midnight ZK ID" value={truncHex(state.seller)} mono />
        <InfoChip label="Item Fingerprint" value={truncHex(state.item_hash)} mono />
      </div>

      {/* ── Privacy model strip ── */}
      <div
        style={{
          background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.15)',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 22,
        }}
      >
        <p style={{ fontSize: 11, color: 'var(--purple-400)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          🔒 Privacy Model
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <PrivacyRow icon="👁" label="Visible" value="Highest bid amount" />
          <PrivacyRow icon="🔒" label="Hidden" value="Reserve price" />
          <PrivacyRow icon="👁" label="Visible" value="ZK-derived bidder key" />
          <PrivacyRow icon="🔒" label="Hidden" value="Real wallet addresses" />
          <PrivacyRow icon="👁" label="Visible" value="Auction status" />
          <PrivacyRow icon="🔒" label="Hidden" value="Who placed which bid" />
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: 10 }}>
        {isOpen && !isSeller && onBid && (
          <button
            id={`bid-btn-${contractAddress.slice(0, 8)}`}
            className="btn btn-primary"
            onClick={onBid}
            disabled={isActionPending}
            style={{ flex: 1 }}
          >
            {isActionPending ? <><span className="spinner" />Submitting Proof…</> : <>Place Bid</>}
          </button>
        )}

        {isOpen && isSeller && onSettle && (
          <button
            id={`settle-btn-${contractAddress.slice(0, 8)}`}
            className="btn btn-primary"
            onClick={onSettle}
            disabled={isActionPending}
            style={{ flex: 1 }}
          >
            {isActionPending ? <><span className="spinner" />Settling…</> : <>Reveal & Settle</>}
          </button>
        )}

        {isExpired && onWithdraw && (
          <button
            id={`withdraw-btn-${contractAddress.slice(0, 8)}`}
            className="btn btn-danger"
            onClick={onWithdraw}
            disabled={isActionPending}
            style={{ flex: 1 }}
          >
            {isActionPending ? <><span className="spinner" />Processing…</> : <>Withdraw (Expired)</>}
          </button>
        )}

        {isSettled && (
          <div
            className="badge badge-green"
            style={{ padding: '10px 20px', fontSize: 13, width: '100%', justifyContent: 'center' }}
          >
            ✅ Auction Settled — Winner: {truncHex(state.highest_bidder)}
          </div>
        )}
      </div>
    </article>
  );
}

// ── Sub-components ────────────────────────────────────────────

function StatusBadge({ status }: { status: AuctionStatus }) {
  const map: Record<AuctionStatus, { className: string; label: string }> = {
    [AuctionStatus.OPEN]:     { className: 'badge badge-green',  label: '● Live' },
    [AuctionStatus.SETTLED]:  { className: 'badge badge-cyan',   label: '✓ Settled' },
    [AuctionStatus.EXPIRED]:  { className: 'badge badge-red',    label: '✕ Expired' },
  };
  const { className, label } = map[status];
  return <span className={className}>{label}</span>;
}

function InfoChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 8,
        padding: '6px 12px',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function PrivacyRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 4 }}>{label}:</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{value}</span>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="var(--purple-400)" style={{ width: 18, height: 18 }}>
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
    </svg>
  );
}

function BidIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 11, height: 11 }}>
      <path d="M10.561 8.073a6.005 6.005 0 011.06 1.928A8.5 8.5 0 108 3a8.472 8.472 0 01-3.998 1H3a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5h1a.5.5 0 01.5.5v.5A6.5 6.5 0 1014 8.5a6.472 6.472 0 00-3.439-.427z" />
    </svg>
  );
}
