'use client';

/**
 * app/auctions/page.tsx — Auctions Dashboard
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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
  const [auctions, setAuctions]   = useState<Array<{ address: string; state: AuctionState; itemDescription: string; deployerAddress: string | null }>>([]);
  const [lookupAddress, setLookupAddress] = useState('');
  const [loadingAuctions, setLoadingAuctions] = useState(false);

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

  // ── Fetch deployed auctions from Database ──────────────────────────────────
  const loadAuctions = useCallback(async () => {
    setLoadingAuctions(true);
    try {
      const res = await fetch('/api/auctions');
      const data = await res.json();

      if (data.auctions && data.auctions.length > 0) {
        const api = await ensureApi();
        if (!api) { setLoadingAuctions(false); return; }

        const loaded = [];
        for (const a of data.auctions) {
          try {
            const state = await api.getState(a.contractAddress);
            loaded.push({
              address: a.contractAddress,
              state,
              itemDescription: a.itemDescription ?? '',
              deployerAddress: a.deployerAddress ?? null,
            });
          } catch (err) {
            console.warn(`Failed to load auction ${a.contractAddress}:`, err);
            // Still show the card in a degraded state so it isn’t silently dropped
            loaded.push({
              address: a.contractAddress,
              state: {
                seller: '',
                reserve_commitment: '',
                highest_bid: 0n,
                highest_bidder: '',
                auction_end_block: 0n,
                status: 'OPEN' as any,
                bid_count: 0,
                item_hash: '',
              },
              itemDescription: a.itemDescription ?? '',
              deployerAddress: a.deployerAddress ?? null,
            });
          }
        }
        setAuctions(loaded);
      } else {
        setAuctions([]);
      }
    } catch (err) {
      console.error('Failed to fetch auctions from DB', err);
      toast.error('Failed to load auctions', 'Check your connection and try refreshing.');
    } finally {
      setLoadingAuctions(false);
    }
  }, [ensureApi, toast]);

  useEffect(() => {
    if (wallet.connector) {
      loadAuctions();
    }
  }, [wallet.connector, loadAuctions]);

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
      
      // Mark this contract as one deployed by this user (stored locally as a fallback)
      try {
        const key = 'zkauction:seller-contracts';
        const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (!existing.includes(address)) existing.push(address);
        localStorage.setItem(key, JSON.stringify(existing));
      } catch {}

      // Save to database — include deployer wallet address so any device can identify the seller
      await fetch('/api/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: address,
          itemDescription: data.itemDescription,
          deployerAddress: wallet.address ?? null,
        }),
      });

      setAuctions(prev => [{ address, state, itemDescription: data.itemDescription, deployerAddress: wallet.address ?? null }, ...prev]);
      setShowCreate(false);
      toast.success('Auction deployed! 🎉', (
        <div>
          Contract:{' '}
          <a
            href={`https://explorer.1am.xyz/address/${address}?network=preview`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--cyan-400)', textDecoration: 'underline' }}
          >
            {address.slice(0, 16)}…
          </a>
        </div>
      ));
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
      toast.success('Bid placed! ✅', (
        <div>
          Tx:{' '}
          <a
            href={`https://explorer.1am.xyz/tx/${result.txHash}?network=preview`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--cyan-400)', textDecoration: 'underline' }}
          >
            {result.txHash.slice(0, 16)}…
          </a>
        </div>
      ));
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
    const addr = lookupAddress.trim();
    try {
      const api = await ensureApi();
      if (!api) return;

      const state = await api.getState(addr);

      // Try to fetch itemDescription + deployerAddress from DB
      let itemDescription = '';
      let deployerAddress: string | null = null;
      try {
        const res = await fetch('/api/auctions');
        const data = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = (data.auctions ?? []).find((a: any) => a.contractAddress === addr);
        itemDescription = found?.itemDescription ?? '';
        deployerAddress = found?.deployerAddress ?? null;
      } catch { /* ignore */ }

      const existing = auctions.find(a => a.address === addr);
      if (!existing) {
        setAuctions(prev => [...prev, { address: addr, state, itemDescription, deployerAddress }]);
        toast.success('Auction loaded!');
      } else {
        setAuctions(prev =>
          prev.map(a => a.address === addr
            ? { ...a, state, itemDescription: itemDescription || a.itemDescription, deployerAddress: deployerAddress ?? a.deployerAddress }
            : a
          )
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
      {/* ── Loading Overlay ───────────────────────────────────────────── */}
      {loadingAuctions && <LoadingOverlay />}

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <Navbar wallet={wallet} />

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1200, margin: '0 auto', width: '100%', padding: '48px 24px' }}>

        <section style={{ textAlign: 'center', marginBottom: 40, marginTop: 20 }}>
          {wallet.isConnected ? (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              id="create-auction-btn"
              className="btn btn-primary"
              onClick={() => setShowCreate(true)}
              style={{ fontSize: 16, padding: '14px 28px' }}
            >
              <PlusIcon />
              Create Private Auction
            </button>
            <button
              id="refresh-auctions-btn"
              className="btn btn-ghost"
              onClick={loadAuctions}
              disabled={loadingAuctions}
              style={{ fontSize: 15, padding: '14px 20px', border: '1px solid rgba(255,255,255,0.1)' }}
              title="Refresh auction list"
            >
              <RefreshIcon spinning={loadingAuctions} />
              {loadingAuctions ? 'Syncing…' : 'Refresh'}
            </button>
          </div>
          ) : (
            <div style={{ padding: '40px', background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px dashed rgba(255,255,255,0.1)' }}>
              <h2 style={{ fontSize: 24, marginBottom: 16, fontFamily: 'var(--font-display)' }}>Connect to continue</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>You need to connect your 1AM wallet to interact with auctions.</p>
              <button
                id="hero-connect-btn"
                className="btn btn-primary"
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
                style={{ fontSize: 16, padding: '14px 28px' }}
              >
                {wallet.isConnecting ? <><span className="spinner" />Connecting…</> : <>Connect 1AM Wallet</>}
              </button>
            </div>
          )}
          
          {wallet.error && (
            <div style={{ marginTop: 20, color: 'var(--red-400)' }}>⚠️ {wallet.error}</div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
            {auctions.map(({ address, state, itemDescription, deployerAddress }) => {
              // isSeller: compare stored deployer wallet address with current wallet address
              // Also fallback to localStorage for older auctions created before the DB change
              let isSellerForThis = false;
              if (wallet.isConnected && !!wallet.address && !!deployerAddress && deployerAddress === wallet.address) {
                isSellerForThis = true;
              } else if (wallet.isConnected) {
                try {
                  const key = 'zkauction:seller-contracts';
                  const sellerContracts: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
                  if (sellerContracts.includes(address)) {
                    isSellerForThis = true;
                  }
                } catch {}
              }
              return (
                <AuctionCard
                  key={address}
                  state={state}
                  contractAddress={address}
                  itemDescription={itemDescription}
                  isSeller={isSellerForThis}
                  onBid={() => setBidTarget({ address, state })}
                  onSettle={() => handleSettle(address)}
                  onWithdraw={() => handleWithdraw(address)}
                  isActionPending={
                    pendingSettle === address ||
                    pendingWithdraw === address ||
                    (pendingBid && bidTarget?.address === address)
                  }
                />
              );
            })}
          </div>
        </section>

        {/* No Privacy Model section here anymore */}

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

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      style={{ 
        width: 16, 
        height: 16,
        animation: spinning ? 'spin 1s linear infinite' : 'none' 
      }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ── Loading Overlay ───────────────────────────────────────────────────────────
function LoadingOverlay() {
  return (
    <div
      role="status"
      aria-label="Loading auctions"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(9, 9, 18, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: 24,
          padding: '48px 56px',
          textAlign: 'center',
          maxWidth: 380,
          boxShadow: '0 0 60px rgba(139,92,246,0.2), 0 24px 48px rgba(0,0,0,0.5)',
          animation: 'fadeUp 0.3s ease',
        }}
      >
        {/* Animated ZK lock icon */}
        <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 28px' }}>
          {/* Outer spinning ring */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: 'var(--purple-400)',
            borderRightColor: 'var(--cyan-400)',
            animation: 'spin 1.2s linear infinite',
          }} />
          {/* Inner glow */}
          <div style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          {/* Lock icon */}
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
          }}>🔒</div>
        </div>

        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Syncing with Midnight
        </h3>
        <p style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: 24,
        }}>
          Fetching auction states from the blockchain.
          <br />
          This may take a few seconds…
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--purple-400)',
                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes bounce {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
            40% { transform: translateY(-8px); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
