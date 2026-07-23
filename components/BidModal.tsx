'use client';

/**
 * components/BidModal.tsx
 * Modal for bidders to place a bid on an auction.
 */

import { useState, type FormEvent } from 'react';
import type { AuctionState } from '@/lib/types';

interface Props {
  isOpen: boolean;
  isPending: boolean;
  state: AuctionState;
  contractAddress: string;
  onClose: () => void;
  onBid: (amountMicro: bigint) => Promise<void>;
}

export function BidModal({ isOpen, isPending, state, contractAddress, onClose, onBid }: Props) {
  const [amount, setAmount] = useState('');
  const [error, setError]   = useState<string | null>(null);

  if (!isOpen) return null;

  const currentBidNight = Number(state.highest_bid) / 1_000_000;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountNum = Number(amount);
    if (!amount || amountNum <= 0) { setError('Enter a valid bid amount'); return; }
    if (amountNum <= currentBidNight) {
      setError(`Bid must exceed the current highest bid of ${currentBidNight.toFixed(2)} tNIGHT`);
      return;
    }

    const amountMicro = BigInt(Math.round(amountNum * 1_000_000));
    await onBid(amountMicro);
  };

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', zIndex: 200, animation: 'fadeIn 0.2s ease' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bid-modal-title"
        style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 201, padding: 20, pointerEvents: 'none' }}
      >
        <div className="glass" style={{ width: '100%', maxWidth: 460, pointerEvents: 'all', animation: 'fadeUp 0.3s ease' }}>
          {/* Header */}
          <div style={{ padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 id="bid-modal-title" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                Place a Bid
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Your wallet address stays private — only your ZK-derived key is revealed.
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }} aria-label="Close">
              <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 20, height: 20 }}>
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} style={{ padding: '24px 28px 28px' }}>
            {/* Contract address */}
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                wordBreak: 'break-all',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-sans)', display: 'block', marginBottom: 2 }}>Contract</span>
              {contractAddress}
            </div>

            {/* Current bid display */}
            {state.highest_bid > 0n && (
              <div style={{ marginBottom: 20, padding: '12px 16px', background: 'rgba(139,92,246,0.08)', borderRadius: 10, border: '1px solid rgba(139,92,246,0.2)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current highest bid: </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--purple-400)' }}>
                  {currentBidNight.toFixed(2)} tNIGHT
                </span>
              </div>
            )}

            {/* Bid input */}
            <div style={{ marginBottom: 8 }}>
              <label htmlFor="bid-amount" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Your Bid (tNIGHT)
              </label>
              <input
                id="bid-amount"
                type="number"
                className="input"
                placeholder={state.highest_bid > 0n ? `More than ${(currentBidNight + 0.01).toFixed(2)}` : 'e.g. 1500'}
                min="0.000001"
                step="any"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isPending}
                autoFocus
              />
              {error && (
                <p style={{ fontSize: 12, color: 'var(--red-400)', marginTop: 6 }}>{error}</p>
              )}
            </div>

            {/* Privacy callout */}
            <div style={{ marginBottom: 24, padding: '10px 14px', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--cyan-400)', fontWeight: 600 }}>🔒 Identity Privacy: </span>
              On-chain, you appear as{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cyan-400)' }}>
                hash(your_secret_key)
              </code>
              — not your wallet address. This hash is unique to this contract.
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isPending} style={{ flex: 1 }}>Cancel</button>
              <button id="submit-bid-btn" type="submit" className="btn btn-primary" disabled={isPending} style={{ flex: 2 }}>
                {isPending ? <><span className="spinner" />Generating Proof…</> : <>Submit Bid</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
