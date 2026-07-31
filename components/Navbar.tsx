'use client';

/**
 * components/Navbar.tsx
 * Top navigation bar with ZKAuction branding and 1AM wallet connect button.
 */

import type { WalletHookState } from '@/hooks/useWallet';
import Link from 'next/link';

interface NavbarProps {
  wallet: WalletHookState;
}

export function Navbar({ wallet }: NavbarProps) {
  return (
    <header
      role="banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        borderBottom: '1px solid rgba(139,92,246,0.15)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(8,10,18,0.85)',
      }}
    >
      <div className="px-4 md:px-6 h-16" style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* ZKAuction logo from /public/logo.png */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              filter: 'drop-shadow(0 0 12px rgba(139,92,246,0.5))',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="ZKAuction logo"
              width={40}
              height={40}
              style={{ objectFit: 'contain', width: '100%', height: '100%' }}
            />
          </div>
          <div>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 18,
                background: 'linear-gradient(135deg, #a78bfa, #22d3ee)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.02em',
              }}
            >
              ZKAuction
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 500,
                marginTop: -2,
              }}
            >
              Midnight Network
            </span>
          </div>
        </div>

        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-1"
        >
          <NavLink href="/">Home</NavLink>
          <NavLink href="/auctions">Auctions</NavLink>
          <NavLink href="/privacy">Privacy Model</NavLink>
        </nav>

        {/* Wallet button area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          {wallet.isConnected ? (
            <ConnectedBadge
              address={wallet.shortAddress!}
              onDisconnect={wallet.disconnect}
            />
          ) : wallet.isPendingError ? (
            /* ── "Already pending" error state ── */
            <PendingErrorBadge onReset={wallet.resetAndReconnect} onDiscard={wallet.disconnect} />
          ) : (
            <>
              <button
                id="wallet-connect-btn"
                className="btn btn-primary"
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
                aria-label="Connect 1AM wallet"
                style={{ gap: 8, fontSize: 13, padding: '9px 18px' }}
              >
                {wallet.isConnecting ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    Connecting…
                  </>
                ) : (
                  <>
                    <WalletIcon />
                    Connect Wallet
                  </>
                )}
              </button>
              {/* Debug info shown while connecting */}
              {wallet.isConnecting && wallet.debugInfo && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  padding: '8px 14px',
                  background: 'rgba(8,10,18,0.95)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--purple-300)',
                  whiteSpace: 'nowrap',
                  zIndex: 200,
                }}>
                  ⏳ {wallet.debugInfo}
                </div>
              )}
              {/* Generic (non-pending) error */}
              {!wallet.isConnecting && wallet.error && !wallet.isPendingError && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  padding: '10px 14px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#fca5a5',
                  maxWidth: 280,
                  zIndex: 200,
                }}>
                  ⚠️ {wallet.error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        textDecoration: 'none',
        transition: 'color 0.2s, background 0.2s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)';
        (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(139,92,246,0.1)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)';
        (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Shown when the 1AM wallet throws "Connection request already pending".
 * Instructs the user to dismiss the wallet popup, then offers Discard & Retry.
 */
function PendingErrorBadge({
  onReset,
  onDiscard,
}: {
  onReset: () => void;
  onDiscard: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      {/* Amber warning badge inline with navbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'rgba(251,191,36,0.08)',
        border: '1px solid rgba(251,191,36,0.4)',
        borderRadius: 10,
        fontSize: 13,
        color: '#fde68a',
        cursor: 'default',
      }}>
        <span>⏳</span>
        <span>Connection pending…</span>
      </div>

      {/* Dropdown panel */}
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        background: 'rgba(8,10,18,0.97)',
        border: '1px solid rgba(251,191,36,0.35)',
        borderRadius: 12,
        padding: '16px',
        width: 300,
        zIndex: 300,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <p style={{ fontSize: 13, color: '#fde68a', fontWeight: 600, margin: '0 0 6px' }}>
          ⚠️ Wallet popup already open
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>
          The 1AM wallet has a connection request waiting. Either{' '}
          <strong style={{ color: 'var(--text-primary)' }}>approve or reject it</strong>{' '}
          in the extension popup, then click Retry below.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            id="wallet-pending-retry-btn"
            className="btn btn-primary"
            onClick={onReset}
            style={{ fontSize: 12, padding: '7px 14px', flex: 1, gap: 6 }}
          >
            🔄 Discard &amp; Retry
          </button>
          <button
            id="wallet-pending-cancel-btn"
            className="btn btn-ghost"
            onClick={onDiscard}
            style={{ fontSize: 12, padding: '7px 12px' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectedBadge({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Live indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          background: 'rgba(74,222,128,0.08)',
          border: '1px solid rgba(74,222,128,0.25)',
          borderRadius: 10,
          fontSize: 13,
        }}
      >
        <span className="pulse-dot" />
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 500 }}>
          {address}
        </span>
      </div>
      <button
        onClick={onDisconnect}
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: '7px 12px' }}
        aria-label="Disconnect wallet"
      >
        Disconnect
      </button>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 15, height: 15 }}>
      <path d="M1 4.25a3.733 3.733 0 012.25-.75h13.5c.844 0 1.624.279 2.25.75A2.25 2.25 0 0016.75 2H3.25A2.25 2.25 0 001 4.25zM1 7.25a3.733 3.733 0 012.25-.75h13.5c.844 0 1.624.279 2.25.75A2.25 2.25 0 0016.75 5H3.25A2.25 2.25 0 001 7.25zM7 8a1 1 0 000 2 2 2 0 110 4H7a1 1 0 100 2h1a4 4 0 100-8H7z" />
      <path d="M1.5 9.5A2.5 2.5 0 014 7h13a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0117 19H4a2.5 2.5 0 01-2.5-2.5v-7zm14 4.5a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}
