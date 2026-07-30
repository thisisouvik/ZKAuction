'use client';

import { useWallet } from '@/hooks/useWallet';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Home() {
  const wallet = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null; // Avoid hydration mismatch

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
      <Navbar wallet={wallet} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
        <section style={{ 
          width: '100%', 
          padding: '120px 24px 80px', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          textAlign: 'center',
          position: 'relative'
        }}>
          {/* Subtle background glow for hero */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80%',
            height: '80%',
            background: 'radial-gradient(ellipse, rgba(139,92,246,0.15) 0%, transparent 70%)',
            zIndex: -1,
            pointerEvents: 'none',
          }} />

          <div
            className="badge badge-purple fade-up"
            style={{ display: 'inline-flex', marginBottom: 24, fontSize: 13, padding: '8px 16px', fontWeight: 600 }}
          >
            <span className="pulse-dot" />
            Live on Midnight Preprod
          </div>

          <h1
            className="fade-up stagger-1"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(42px, 7vw, 76px)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
              marginBottom: 24,
              maxWidth: 900,
            }}
          >
            The Ultimate
            <br />
            <span className="gradient-text">
              Zero-Knowledge Auction Platform
            </span>
          </h1>

          <p
            className="fade-up stagger-2"
            style={{
              fontSize: 'clamp(18px, 2vw, 22px)',
              color: 'var(--text-secondary)',
              maxWidth: 700,
              lineHeight: 1.6,
              marginBottom: 48,
            }}
          >
            Sell high-value items with absolute privacy. Built on Midnight Network, 
            reserve prices remain mathematically hidden while proving correct settlements. 
            No more front-running. No more revealed strategies.
          </p>

          <div className="fade-up stagger-3" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/auctions" className="btn btn-primary" style={{ fontSize: 18, padding: '16px 36px', boxShadow: '0 0 30px rgba(139,92,246,0.4)' }}>
              Launch App
            </Link>
            <Link href="/privacy" className="btn btn-ghost" style={{ fontSize: 18, padding: '16px 36px', border: '1px solid rgba(255,255,255,0.1)' }}>
              Explore Privacy Model
            </Link>
          </div>
        </section>

        {/* ── FEATURES GRID ────────────────────────────────────────────────── */}
        <section style={{ width: '100%', maxWidth: 1200, padding: '80px 24px', zIndex: 10 }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2 style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 700, marginBottom: 16 }}>
              Why ZKAuction?
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 18, maxWidth: 600, margin: '0 auto' }}>
              Traditional blockchain auctions expose all bids and reserves to the public. 
              We use cryptography to keep your strategies safe.
            </p>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
            gap: 24 
          }}>
            {FEATURES.map((feat, i) => (
              <div 
                key={i} 
                className="glass glass-hover fade-up"
                style={{ padding: 32, animationDelay: `${i * 100}ms` }}
              >
                <div style={{ fontSize: 40, marginBottom: 20 }}>{feat.icon}</div>
                <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
                  {feat.title}
                </h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 15 }}>
                  {feat.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
        <section style={{ width: '100%', maxWidth: 1000, padding: '80px 24px', marginBottom: 80 }}>
          <div className="glass" style={{ padding: '64px 40px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            {/* Inner glow */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
              background: 'var(--grad-purple-cyan)', opacity: 0.8
            }} />
            
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, marginBottom: 48 }}>
              How ZK-Settlement Works
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32, textAlign: 'left' }}>
              <div>
                <div style={{ color: 'var(--cyan-400)', fontWeight: 800, fontSize: 48, opacity: 0.3, lineHeight: 1, marginBottom: 16 }}>01</div>
                <h4 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Cryptographic Commitment</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  The seller locks a hash of their reserve price and a random salt on the blockchain. The actual price never leaves their device.
                </p>
              </div>
              <div>
                <div style={{ color: 'var(--purple-400)', fontWeight: 800, fontSize: 48, opacity: 0.3, lineHeight: 1, marginBottom: 16 }}>02</div>
                <h4 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Shielded Bidding</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  Bidders submit their bids on-chain. Bidder identities are masked using derived cryptographic keys, not public addresses.
                </p>
              </div>
              <div>
                <div style={{ color: 'var(--pink-500)', fontWeight: 800, fontSize: 48, opacity: 0.3, lineHeight: 1, marginBottom: 16 }}>03</div>
                <h4 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Zero-Knowledge Proof</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  At auction close, the seller provides a ZK-proof that mathematically guarantees whether the highest bid met the reserve, without ever exposing what the reserve was.
                </p>
              </div>
            </div>
            
            <div style={{ marginTop: 56 }}>
              <Link href="/privacy" className="btn btn-primary" style={{ padding: '12px 24px' }}>
                Read the Technical Deep Dive →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer style={{ textAlign: 'center', padding: '40px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,10,18,0.5)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Logo" width={24} height={24} style={{ filter: 'grayscale(1) brightness(1.5)', opacity: 0.7 }} />
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>ZKAuction</span>
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            The premier privacy-preserving auction dApp. Powered by Midnight Network.
          </p>
          <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
            <Link href="/" style={{ color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none' }}>Home</Link>
            <Link href="/auctions" style={{ color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none' }}>Auctions</Link>
            <Link href="/privacy" style={{ color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none' }}>Privacy Model</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    icon: '🔐',
    title: 'Hidden Reserve Prices',
    desc: 'Sellers submit a cryptographic hash of their reserve. Bidders bid on true value, not just the minimum threshold.',
  },
  {
    icon: '👻',
    title: 'Anonymous Participants',
    desc: 'Bidder identities are masked using unique, deterministic keys. Your main wallet address is never linked to your bids.',
  },
  {
    icon: '⚡',
    title: 'Trustless Settlement',
    desc: 'When time is up, a Zero-Knowledge Proof settles the auction automatically. The math guarantees fairness without trusting a centralized party.',
  },
  {
    icon: '💎',
    title: 'Premium Assets',
    desc: 'Perfect for OTC deals, luxury goods, and rare NFTs where public price discovery harms the seller\'s leverage.',
  },
  {
    icon: '🛡️',
    title: 'Anti-Frontrunning',
    desc: 'Because reserve prices are hidden, MEV bots and malicious actors cannot game the system or snipe thresholds.',
  },
  {
    icon: '🌌',
    title: 'Powered by Midnight',
    desc: 'Leveraging the Midnight Network\'s native data protection and compact ZK circuits for lightning-fast private smart contracts.',
  },
];
