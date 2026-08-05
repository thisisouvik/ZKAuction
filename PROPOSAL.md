# Project Proposal: ZKAuction

## 1. Project Overview
**ZKAuction** is a decentralized, privacy-preserving auction platform built on the Midnight Network. It enables sellers to auction high-value items with a cryptographically hidden reserve price. Bidders can participate in a fully shielded environment where their identities and bid strategies are protected. 

## 2. The Problem
In traditional transparent blockchains (like Ethereum or Cardano), auction parameters such as the reserve price are fully public. This creates a significant disadvantage for sellers, as bidders will often wait until the last minute and bid exactly the reserve price, artificially suppressing the true market value of the item. Furthermore, bidders' identities and bidding strategies are completely visible, allowing competitors to track their behavior, maliciously outbid them, or front-run their transactions using MEV bots.

## 3. The Solution using Midnight
ZKAuction leverages the Midnight Network's zero-knowledge (ZK) data protection capabilities. By utilizing ZK smart contracts (written in Compact), ZKAuction allows sellers to cryptographically hide their reserve price. Bidders can place bids freely without knowing the exact reserve limit. When the auction ends, the smart contract settles the auction and proves whether the highest bid met the hidden reserve price—without ever revealing the reserve price itself! Additionally, bidder identities are kept strictly private and decoupled from their real wallet addresses.

## 4. Key Features
- **Hidden Reserve Prices:** Sellers submit a cryptographic hash of their reserve price and a salt.
- **Shielded Bidding:** Bidder identities are masked using derived cryptographic keys, not public addresses.
- **Zero-Knowledge Settlement:** At the end of the auction, a ZK proof guarantees whether the highest bid met the reserve, without exposing the reserve price.
- **Anti-Frontrunning:** Hidden reserve prices prevent MEV bots from sniping thresholds.

## 5. Technical Architecture
- **Smart Contracts:** Written in Compact (Midnight's ZK DSL).
- **Frontend:** Next.js (React) with Tailwind CSS for a modern, responsive UI.
- **Wallet Integration:** Uses the 1AM Wallet browser extension for signing and Midnight JS SDK for circuit execution.
- **Off-chain Storage:** Neon Postgres database for storing off-chain metadata (item descriptions).

## 6. Project Status
- ✅ Smart Contracts written, tested, and compiled.
- ✅ Frontend built and integrated with Midnight SDK.
- ✅ Deployed to Midnight Preprod Network.
- ✅ E2E Testing passing.
