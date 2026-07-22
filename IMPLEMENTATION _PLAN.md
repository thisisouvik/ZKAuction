# 🔒 Private Reserve Auction dApp — Midnight Preprod

## Background & Goal

This project builds a **privacy-preserving auction** on the **Midnight blockchain** where:
- The **reserve price** is hidden from all observers (stored as a ZK-committed value off-chain)
- **Bidder identities** are private (DApp-specific key pairs, not wallet addresses)
- Only the **winning bid outcome** becomes public, not the individual bids during the auction
- The contract is verified and deployed to **Midnight Preprod testnet**
- A **live frontend** (React + Vite, deployed to Vercel/Netlify) lets users connect Lace wallet and interact

This is your **first Midnight project**, so every phase includes beginner-friendly explanations of why each step exists.

---

## Open Questions

> [!IMPORTANT]
> Please review the items below before we begin Phase 1.

1. **Lace Midnight Wallet** — Do you have the Lace Beta browser extension installed? (Required for wallet connect flow). If not, you'll need to install it from https://www.lace.io and switch it to "Preprod" network mode.
2. **Docker Desktop** — Is Docker Desktop installed and running? The Midnight Proof Server runs in Docker during local testing.
3. **Node.js version** — Midnight SDK requires **Node.js v22+**. Please run `node -v` to verify.
4. **Git repository** — Should I initialize a GitHub repository so the CI/CD badge is real? If yes, do you want it public or private?
5. **Vercel vs Netlify** — Which hosting platform for the live demo link?

> [!NOTE]
> If you don't have answers to all questions right now, that's fine — I'll guide you to set each prerequisite up as we reach that phase.

---

## What an Observer Can and Cannot Learn (Privacy Model)

| What they observe on-chain | What they **cannot** learn |
|---|---|
| That an auction contract exists at a given address | The reserve price (stored only as a commitment hash) |
| The number of bids submitted | Individual bid amounts (proven privately via ZK circuits) |
| The auction end block / time | Bidder real wallet addresses (DApp-specific ephemeral keys used) |
| Whether the auction settled (won/expired) | Whether any specific person bid |
| The winning bid amount (only after settlement) | The margin between winning bid and reserve price |

Midnight uses **zero-knowledge proofs** to verify that "the bid is ≥ reserve" without exposing either value. The proof server runs locally on the bidder's machine, so sensitive data never leaves their device.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite, deployed to Vercel/Netlify)       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ WalletConn  │  │ AuctionPanel │  │ PrivacyModelPage │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘  │
│         │                │                                  │
│  ┌──────▼────────────────▼──────────────────────────────┐  │
│  │  Midnight.js Provider Stack                           │  │
│  │  walletProvider ← Lace window.midnight.mnLace         │  │
│  │  proofProvider  ← Midnight Proof Server (Preprod)     │  │
│  │  privateStateProvider ← IndexedDB (local)             │  │
│  └─────────────────────────┬─────────────────────────────┘  │
└────────────────────────────┼──────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Compact Contract │  (.compact)
                    │ ┌─────────────┐ │
                    │ │   Ledger    │ │  (public on-chain state)
                    │ │ - auction_id│ │
                    │ │ - reserve_  │ │
                    │ │   commitment│ │
                    │ │ - highest_  │ │
                    │ │   bid (pub) │ │
                    │ │ - status    │ │
                    │ └─────────────┘ │
                    │ ┌─────────────┐ │
                    │ │  Circuits   │ │  (ZK functions)
                    │ │ - createAuction │
                    │ │ - placeBid  │ │
                    │ │ - settle    │ │
                    │ │ - withdraw  │ │
                    │ └─────────────┘ │
                    └─────────────────┘
                             │
                    Midnight Preprod Testnet
```

---

## Phase-wise Implementation Plan

---

### Phase 0 — Environment Setup & Toolchain

> **Why this phase?** Midnight's toolchain (Compact compiler, proof server, SDK) requires specific prerequisites. Getting this right first saves hours of debugging later.

#### Steps:
1. **Verify prerequisites** on Windows with WSL2 (Midnight's CLI is Linux-native)
   - Node.js v22+, Docker Desktop, Git, WSL2
2. **Install the Compact toolchain** via the official Midnight developer tools
3. **Install Lace Beta wallet** browser extension, configure for Preprod
4. **Get test tNIGHT tokens** from the Midnight faucet for contract deployment
5. **Scaffold the project** using `npx create-mn-app ./` with the "bboard" template (the canonical starting point), then we customize it for auction logic

#### Files created in this phase:
- `package.json`, `pnpm-workspace.yaml` / `yarn.lock` (monorepo root)
- Docker `compose.yml` for local proof server
- `.env.example` with all required environment variables

---

### Phase 1 — Compact Smart Contract

> **Why Compact?** Compact is Midnight's DSL. It compiles to both an on-chain circuit and a TypeScript API. It enforces the privacy model at the language level — you cannot accidentally leak private state.

#### [NEW] `contract/src/auction.compact`

The contract defines:

```compact
// PUBLIC on-chain state (ledger)
ledger {
  seller: PublicKey,                    // auction creator's DApp key
  reserve_commitment: Bytes<32>,        // hash of (reserve_price || salt) — NEVER the price itself
  highest_bidder: PublicKey,            // current highest bidder's DApp key
  highest_bid: Uint64,                  // amount — becomes public once bid is placed
  auction_end_block: Uint64,            // block number after which bidding closes
  settled: Boolean,                     // true once winner is announced
  item_description: Opaque<String>,     // encrypted item details (only seller can read)
}

// CIRCUITS (ZK-provable functions)

// 1. createAuction — called by seller
//    Witnesses (private inputs):  reserve_price, salt
//    Public inputs:               item_description, duration_blocks
//    What the ZK proof guarantees: commitment = hash(reserve_price || salt) is correct
circuit createAuction(
  reserve_price: Uint64,         // private witness — never leaves seller's device
  salt: Bytes<32>,               // private witness
  item_description: String,
  duration_blocks: Uint64
): [] { ... }

// 2. placeBid — called by bidder
//    Witnesses (private inputs):  bidder_private_key (to generate DApp-specific key)
//    Public inputs:               bid_amount
//    What the ZK proof guarantees: bidder is authorized, bid_amount > 0
circuit placeBid(bid_amount: Uint64): [] { ... }

// 3. settle — called by seller after auction_end_block
//    Witnesses (private inputs):  reserve_price, salt (to open the commitment)
//    What the ZK proof guarantees: hash(reserve_price||salt) == ledger.reserve_commitment
//                                   AND highest_bid >= reserve_price
circuit settle(reserve_price: Uint64, salt: Bytes<32>): [] { ... }

// 4. withdrawExpired — if auction expires with no valid bid meeting reserve
circuit withdrawExpired(): [] { ... }
```

#### [NEW] `contract/src/auction.test.ts` (3+ tests)

```typescript
// Test 1: Successful auction lifecycle
// Test 2: Bid below reserve is rejected at settlement
// Test 3: Multiple bids — highest wins
// Test 4: Expired auction withdrawal
// Test 5: Reserve commitment integrity
```

---

### Phase 2 — TypeScript API Layer

> **Why an API layer?** The Compact compiler generates raw contract types. The API layer wraps them into ergonomic TypeScript classes with proper provider wiring, making them easy to use from both the CLI and the React UI.

#### [NEW] `api/src/auction-api.ts`
- `AuctionAPI` class with `createAuction()`, `placeBid()`, `settle()`, `getState()` methods
- Provider factory connecting `walletProvider`, `proofProvider`, `privateStateProvider`
- Serialization of private state (reserve price + salt) into IndexedDB

#### [NEW] `api/src/providers.ts`
- `buildProviderStack()` function that detects Lace wallet and wires up the full provider chain
- Preprod endpoint configuration

#### [NEW] `api/src/types.ts`
- TypeScript types for `AuctionState`, `BidRecord`, `AuctionConfig`

---

### Phase 3 — CLI Tool (for Testing & Deployment)

> **Why a CLI?** The CLI lets you deploy and test without a UI. It's how you'll get the Preprod contract address and run automated tests. It is also the deployment mechanism that outputs the address.

#### [NEW] `cli/src/index.ts`
Commands:
- `deploy` — compiles contract, deploys to Preprod, prints contract address
- `create-auction` — creates auction with hidden reserve price
- `bid <amount>` — places a bid
- `settle` — settles the auction (seller only)
- `state` — reads current public ledger state

---

### Phase 4 — React Frontend (the dApp UI)

> **Why React + Vite?** Midnight's example apps all use React. Vite gives fast HMR during development and produces a small, optimized bundle for Vercel/Netlify deployment.

#### [NEW] `ui/src/` (React + Vite + TypeScript)

**Pages / Components:**
| Component | Purpose |
|---|---|
| `WalletConnect.tsx` | Detects Lace, shows connect button, displays wallet address |
| `CreateAuction.tsx` | Seller enters reserve price (private), item description, duration |
| `AuctionRoom.tsx` | Shows live auction state, bid history (amounts only, no identities) |
| `PlaceBid.tsx` | Bidder enters amount — ZK proof generated client-side |
| `SettleAuction.tsx` | Seller unlocks reserve to finalize |
| `PrivacyModel.tsx` | Explains what observers can/cannot learn (required deliverable) |
| `ContractInfo.tsx` | Shows deployed Preprod address, circuit list |

**Design theme:** Dark glassmorphism with midnight-purple/electric-blue gradient. Subtle auction countdown timer animation.

#### [NEW] `ui/src/hooks/useWallet.ts`
- Manages Lace wallet connection lifecycle
- Polls wallet state for balance updates

#### [NEW] `ui/src/lib/providers.ts`
- Browser-side `buildProviderStack()` for Preprod
- Detects `window.midnight.mnLace`

---

### Phase 5 — CI/CD Pipeline

> **Why CI/CD?** The deliverables require a "CI/CD badge or workflow file with passing runs." GitHub Actions will compile the contract, run tests, and on merge to main, deploy the UI to Vercel.

#### [NEW] `.github/workflows/ci.yml`
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm install
      - run: npm run compile:contract   # compactc → outputs circuit list
      - run: npm run test               # 3+ passing tests
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: npx vercel --prod         # or netlify deploy
```

#### [NEW] `.github/workflows/deploy.yml`
- Production deployment on tag push

---

### Phase 6 — Preprod Deployment & Verification

> **Why this is a separate phase?** Deploying to Preprod requires a funded Lace wallet. This phase walks you through the faucet, deployment CLI command, and verifying the address on-chain.

#### Steps:
1. Fund Lace Preprod wallet with tNIGHT from faucet
2. Run `npm run deploy:preprod` → get contract address
3. Verify address on Midnight explorer
4. Paste address into UI as the canonical contract address
5. Deploy UI to Vercel with contract address as env variable

---

## File Structure (Complete)

```
privete-reserve-auction/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # [NEW] Tests + compile CI
│       └── deploy.yml                # [NEW] Vercel/Netlify deploy
├── contract/
│   └── src/
│       ├── auction.compact           # [NEW] Compact smart contract
│       └── auction.test.ts           # [NEW] Contract tests (3+ tests)
├── api/
│   └── src/
│       ├── auction-api.ts            # [NEW] API class wrapping contract
│       ├── providers.ts              # [NEW] Provider stack builder
│       └── types.ts                  # [NEW] TypeScript types
├── cli/
│   └── src/
│       └── index.ts                  # [NEW] Deploy + interact CLI
├── ui/
│   ├── index.html                    # [NEW] Vite entry
│   ├── vite.config.ts                # [NEW] Vite config
│   └── src/
│       ├── main.tsx                  # [NEW] React entry point
│       ├── App.tsx                   # [NEW] Router + layout
│       ├── index.css                 # [NEW] Dark glassmorphism theme
│       ├── components/
│       │   ├── WalletConnect.tsx     # [NEW]
│       │   ├── CreateAuction.tsx     # [NEW]
│       │   ├── AuctionRoom.tsx       # [NEW]
│       │   ├── PlaceBid.tsx          # [NEW]
│       │   ├── SettleAuction.tsx     # [NEW]
│       │   ├── PrivacyModel.tsx      # [NEW]
│       │   └── ContractInfo.tsx      # [NEW]
│       ├── hooks/
│       │   └── useWallet.ts          # [NEW]
│       └── lib/
│           └── providers.ts          # [NEW]
├── .env.example                      # [NEW] Required env vars
├── package.json                      # [NEW] Monorepo root
└── README.md                         # [NEW] Full project docs
```

---

## Deliverables Checklist

| Deliverable | Phase | How It's Met |
|---|---|---|
| ✅ Successful compile output (circuits listed) | Phase 1 | `compactc auction.compact` outputs circuit names |
| ✅ Contract deployed with address shown | Phase 6 | CLI prints address, UI shows it |
| ✅ Live demo link | Phase 4+6 | Vercel/Netlify URL |
| ✅ Deployed Preprod contract address | Phase 6 | On-chain verifiable |
| ✅ Wallet connect + successful circuit call | Phase 4 | Lace connect → `placeBid` circuit call |
| ✅ 3+ tests passing | Phase 1+5 | auction.test.ts with 5 tests |
| ✅ CI/CD badge + workflow file | Phase 5 | GitHub Actions badge in README |
| ✅ Full functionality demo | Phase 4+6 | Create → Bid → Settle flow in UI |
| ✅ Privacy model section | Phase 4+plan | PrivacyModel.tsx page + README section |

---

## Verification Plan

### Automated Tests
```bash
npm run compile:contract   # must print circuit names
npm run test               # must show 3+ passing
```

### Manual Verification
1. Open UI → Click "Connect Wallet" → Lace popup appears → Confirm → Wallet address shows
2. Create auction with hidden reserve price (1000 tNIGHT) → Tx submitted → Address shown
3. Bid 1200 tNIGHT → ZK proof generated → Bid recorded
4. Settle auction → Reserve commitment opened → Winner announced
5. Verify contract address on Midnight Preprod explorer

---

## Beginner's Guide: Key Midnight Concepts

### What is a "Circuit"?
A circuit in Compact is like a function, but it gets compiled into a zero-knowledge proof circuit. When you call `placeBid(1200)`, your browser runs the proof server locally, generates a mathematical proof that "the bid is valid and meets all rules," and only submits that proof to the blockchain — never the raw data.

### What is a "Witness"?
A witness is private input to a circuit. In `createAuction`, the `reserve_price` is a witness — you tell it to the circuit locally, it never gets written to the blockchain. Only the *commitment* (hash) gets stored on-chain.

### What is a "Ledger"?
The ledger is the public, persistent state stored on-chain. Everything in `ledger { }` is visible to all observers. That's why we put `reserve_commitment` (a hash) there instead of `reserve_price`.

### What is "Lace"?
Lace is the official Midnight wallet (browser extension). It manages your keys, signs transactions, and integrates with DApps via the `window.midnight.mnLace` API.

### What is "Preprod"?
Preprod (Pre-Production) is Midnight's public testnet. It behaves exactly like mainnet but uses fake tokens (tNIGHT) that have no real value. It's the standard testing environment before going live.
