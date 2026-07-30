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
  const [auctions, setAuctions]   = useState<Array<{ address: string; state: AuctionState }>>([]);
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

  // ── Fetch deployed auctions from Database ──────────────────────────────────
  useEffect(() => {
    async function loadAuctions() {
      try {
        const res = await fetch('/api/auctions');
        const data = await res.json();
        
        // Wait for wallet and API before loading states
        if (data.auctions && data.auctions.length > 0) {
          const api = await ensureApi();
          if (!api) return;

          const loaded = [];
          for (const a of data.auctions) {
            try {
              const state = await api.getState(a.contractAddress);
              loaded.push({ address: a.contractAddress, state });
            } catch (err) {
              console.warn(`Failed to load auction ${a.contractAddress}`);
            }
          }
          setAuctions(loaded);
        }
      } catch (err) {
        console.error("Failed to fetch auctions from DB", err);
      }
    }
    
    if (wallet.connector) {
      loadAuctions();
    }
  }, [wallet.connector, ensureApi]);

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
      
      // Save to database
      await fetch('/api/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: address, itemDescription: data.itemDescription }),
      });

      setAuctions(prev => [{ address, state }, ...prev]);
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

        <section style={{ textAlign: 'center', marginBottom: 40, marginTop: 20 }}>
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
