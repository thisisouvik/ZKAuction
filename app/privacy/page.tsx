'use client';

import { useWallet } from '@/hooks/useWallet';
import { Navbar } from '@/components/Navbar';

export default function PrivacyPage() {
  const wallet = useWallet();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
      <Navbar wallet={wallet} />

      <main style={{ flex: 1, maxWidth: 900, margin: '0 auto', padding: '48px 24px', width: '100%' }}>
        <h1
          style={{ fontSize: 36, fontWeight: 700, fontFamily: 'var(--font-display)', textAlign: 'center', marginBottom: 12 }}
        >
          Privacy Model
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 48, fontSize: 18 }}>
          What an observer CAN and CANNOT learn from the public chain
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Visible column */}
          <div className="glass" style={{ padding: 28 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-400)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple-400)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
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
          style={{ padding: 36, marginTop: 40 }}
        >
          <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, fontFamily: 'var(--font-display)' }}>
            How ZK Reserve Price Commitment Works
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
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
              <div key={step} style={{ padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--purple-400)', marginBottom: 8 }}>{step}</div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function PrivacyItem({ icon, name, desc, variant }: { icon: string, name: string, desc: string, variant: 'visible' | 'hidden' }) {
  const isVisible = variant === 'visible';
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 16, marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: isVisible ? 'var(--green-400)' : 'var(--cyan-400)', marginBottom: 4 }}>
          {name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
    </div>
  );
}
