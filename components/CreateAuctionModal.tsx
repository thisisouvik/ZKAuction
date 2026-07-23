'use client';

/**
 * components/CreateAuctionModal.tsx
 *
 * Modal dialog for sellers to create a new private reserve auction.
 * All fields are validated; the reserve price stays private (ZK witness).
 */

import { useState, type FormEvent } from 'react';

export interface CreateAuctionFormData {
  itemDescription: string;
  reservePrice: bigint;
  durationBlocks: bigint;
}

interface Props {
  isOpen: boolean;
  isPending: boolean;
  onClose: () => void;
  onCreate: (data: CreateAuctionFormData) => Promise<void>;
}

export function CreateAuctionModal({ isOpen, isPending, onClose, onCreate }: Props) {
  const [itemDescription, setItemDescription] = useState('');
  const [reservePrice, setReservePrice]       = useState('');
  const [durationBlocks, setDurationBlocks]   = useState('100');
  const [errors, setErrors]                   = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!itemDescription.trim()) e.itemDescription = 'Item description is required';
    if (!reservePrice || Number(reservePrice) <= 0) e.reservePrice = 'Reserve price must be > 0';
    if (!durationBlocks || Number(durationBlocks) < 1) e.durationBlocks = 'Duration must be ≥ 1 block';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate() || isPending) return;

    // Convert NIGHT → µNIGHT (1 NIGHT = 1_000_000 µNIGHT)
    const priceInMicro = BigInt(Math.round(Number(reservePrice) * 1_000_000));

    await onCreate({
      itemDescription: itemDescription.trim(),
      reservePrice: priceInMicro,
      durationBlocks: BigInt(durationBlocks),
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(6px)',
          zIndex: 200,
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-auction-title"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 201,
          padding: '20px',
          pointerEvents: 'none',
        }}
      >
        <div
          className="glass"
          style={{
            width: '100%',
            maxWidth: 520,
            pointerEvents: 'all',
            animation: 'fadeUp 0.3s ease',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '24px 28px 0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h2
                id="create-auction-title"
                style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}
              >
                Create Private Auction
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Your reserve price will be proven via ZK — never stored on-chain.
              </p>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
              aria-label="Close modal"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 20, height: 20 }}>
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ padding: '24px 28px 28px' }}>
            {/* Item description */}
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="item-description"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}
              >
                Item Description
              </label>
              <textarea
                id="item-description"
                className="input"
                placeholder="E.g. Vintage Compact Keyboard #001 — Mint condition, original box"
                value={itemDescription}
                onChange={e => setItemDescription(e.target.value)}
                rows={3}
                style={{ resize: 'none', fontFamily: 'var(--font-sans)' }}
                disabled={isPending}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                A SHA-256 hash of this text is stored on-chain. The text itself stays private.
              </p>
              {errors.itemDescription && <FieldError msg={errors.itemDescription} />}
            </div>

            {/* Reserve price */}
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="reserve-price"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}
              >
                Reserve Price (tNIGHT)
                <span
                  className="badge badge-purple"
                  style={{ marginLeft: 8, verticalAlign: 'middle' }}
                >
                  🔒 Private
                </span>
              </label>
              <input
                id="reserve-price"
                type="number"
                className="input"
                placeholder="e.g. 1000"
                min="0.000001"
                step="any"
                value={reservePrice}
                onChange={e => setReservePrice(e.target.value)}
                disabled={isPending}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                This never leaves your browser. A cryptographic commitment (hash) is stored on-chain instead.
              </p>
              {errors.reservePrice && <FieldError msg={errors.reservePrice} />}
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 28 }}>
              <label
                htmlFor="duration-blocks"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}
              >
                Duration (blocks)
              </label>
              <input
                id="duration-blocks"
                type="number"
                className="input"
                placeholder="100"
                min="1"
                step="1"
                value={durationBlocks}
                onChange={e => setDurationBlocks(e.target.value)}
                disabled={isPending}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Midnight Preprod: ~5 seconds/block. 100 blocks ≈ 8 minutes.
              </p>
              {errors.durationBlocks && <FieldError msg={errors.durationBlocks} />}
            </div>

            {/* ZK Privacy Note */}
            <div
              style={{
                background: 'rgba(139,92,246,0.06)',
                border: '1px solid rgba(139,92,246,0.2)',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 24,
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: 'var(--purple-400)', display: 'block', marginBottom: 4 }}>
                🔒 How ZK Privacy Works
              </strong>
              Your reserve price is combined with a random salt and hashed:{' '}
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan-400)', fontSize: 11 }}>
                commitment = hash(reserve_price, salt)
              </code>
              . Only the commitment hash goes on-chain. At settlement, a ZK proof shows{' '}
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan-400)', fontSize: 11 }}>
                highest_bid ≥ reserve
              </code>{' '}
              without revealing the reserve price.
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={isPending}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                id="create-auction-submit"
                type="submit"
                className="btn btn-primary"
                disabled={isPending}
                style={{ flex: 2 }}
              >
                {isPending ? (
                  <><span className="spinner" />Deploying Contract…</>
                ) : (
                  <>Deploy Auction</>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--red-400)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 12, height: 12, flexShrink: 0 }}>
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.25 4.75a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
      </svg>
      {msg}
    </p>
  );
}
