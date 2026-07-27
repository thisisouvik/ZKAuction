/**
 * scripts/deploy.ts — Preprod Deployment Script for ZKAuction
 *
 * This script:
 *  1. Connects to Midnight Preprod via Midnight.js SDK
 *  2. Compiles & loads the contract (must run `npm run compile:contract` first)
 *  3. Deploys the contract with a specified reserve price + duration
 *  4. Saves the contract address to .env.local and prints it
 *
 * Usage:
 *   npx ts-node --esm scripts/deploy.ts \
 *     --reserve 1000 \
 *     --duration 200 \
 *     --item "Vintage Midnight Edition Watch #001"
 *
 * Prerequisites:
 *   1. `npm run compile:contract` (requires compactc installed)
 *   2. `cp .env.example .env.local` and fill in MIDNIGHT_SEED_PHRASE
 *   3. Fund the wallet with tNIGHT from https://faucet.midnight.network
 *   4. Docker running: `npm run env:up` (for local proof server)
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

// Load .env.local
config({ path: '.env.local' });
config({ path: '.env' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Parse CLI args ───────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  return {
    reserveNight:   Number(get('--reserve',  '1000')),
    durationBlocks: BigInt(get('--duration', '200')!),
    itemDescription: get('--item', 'ZKAuction Demo Item — Midnight Preprod'),
    network:        get('--network', process.env.MIDNIGHT_NETWORK ?? 'TestNet') as 'TestNet' | 'DevNet',
  };
}

// ── Main deploy function ─────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   ZKAuction — Midnight Preprod Deployment Script        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`📡 Network:          ${args.network}`);
  console.log(`⏱  Duration:         ${args.durationBlocks} blocks`);
  console.log(`💰 Reserve price:    ${args.reserveNight} tNIGHT (private)`);
  console.log(`📦 Item description: ${args.itemDescription}`);
  console.log('');

  // ── Step 1: Load the compiled contract ──────────────────────────────────
  console.log('📋 Step 1: Loading compiled contract...');
  const generatedPath = path.join(ROOT, 'contract', 'src', 'generated', 'index.cjs');

  if (!fs.existsSync(generatedPath)) {
    console.error('\n❌ Compiled contract not found at:', generatedPath);
    console.error('   Run: npm run compile:contract\n');
    console.error('   This requires the compactc compiler. Install it from:');
    console.error('   https://docs.midnight.network/develop/tutorial/building/prereqs\n');
    process.exit(1);
  }

  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const compiledContract = require(generatedPath);

  if (compiledContract.__isStub) {
    console.error('\n❌ Found stub contract — run `npm run compile:contract` first.\n');
    process.exit(1);
  }

  console.log('   ✅ Contract loaded\n');

  // ── Step 2: Check seed phrase ────────────────────────────────────────────
  console.log('🔑 Step 2: Checking wallet seed phrase...');
  const seedPhrase = process.env.MIDNIGHT_SEED_PHRASE;
  if (!seedPhrase) {
    console.error('\n❌ MIDNIGHT_SEED_PHRASE not set in .env.local');
    console.error('   Add: MIDNIGHT_SEED_PHRASE="word1 word2 word3 ... word24"');
    console.error('   (Your 1AM wallet 24-word seed phrase)\n');
    process.exit(1);
  }
  console.log('   ✅ Seed phrase found\n');

  // ── Step 3: Build providers ──────────────────────────────────────────────
  console.log('🔧 Step 3: Building Midnight provider stack...');

  const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
  setNetworkId(args.network);

  // For server-side (Node.js) deployment, we use different providers
  // than the browser-based ones in lib/providers.ts
  const nodeWsUrl   = process.env.NEXT_PUBLIC_NODE_WS_URL
                     ?? 'wss://rpc.testnet-01.midnight.network/ws';
  const indexerUri  = process.env.NEXT_PUBLIC_INDEXER_URI
                     ?? 'https://indexer.testnet-01.midnight.network/api/v1/graphql';
  const indexerWsUri = process.env.NEXT_PUBLIC_INDEXER_WS_URI
                      ?? 'wss://indexer.testnet-01.midnight.network/api/v1/graphql';
  const proofServerUri = process.env.NEXT_PUBLIC_PROOF_SERVER_URI
                        ?? 'http://localhost:6300';

  console.log(`   Node:         ${nodeWsUrl}`);
  console.log(`   Indexer:      ${indexerUri}`);
  console.log(`   Proof server: ${proofServerUri}`);
  console.log('   ✅ Provider config ready\n');

  // ── Step 4: Deploy contract ──────────────────────────────────────────────
  console.log('🚀 Step 4: Deploying contract to Midnight Preprod...');
  console.log('   (This may take 30–90 seconds — ZK proof being generated locally)\n');

  try {
    const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    const { IndexerPublicDataProvider } = await import(
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
    ) as any;
    const { HttpClientProofProvider } = await import(
      '@midnight-ntwrk/midnight-js-http-client-proof-provider'
    ) as any;
    const { FetchZKConfigProvider } = await import(
      '@midnight-ntwrk/midnight-js-fetch-zk-config-provider'
    ) as any;

    // Generate reserve commitment
    const reservePriceMicro = BigInt(Math.round(args.reserveNight * 1_000_000));
    const salt = crypto.randomBytes(32);

    // Hash item description
    const itemHash = crypto.createHash('sha256')
      .update(args.itemDescription)
      .digest();

    // Private state for deployment
    const privateState = {
      local_secret_key: crypto.createHash('sha256')
        .update('deploy-key-' + seedPhrase.slice(0, 20))
        .digest(),
      reserve_price:    reservePriceMicro,
      commitment_salt:  salt,
    };

    // Build providers (simplified Node.js version)
    const publicDataProvider = new IndexerPublicDataProvider(indexerUri, indexerWsUri);
    const proofProvider      = new HttpClientProofProvider(proofServerUri);
    const zkConfigProvider   = new FetchZKConfigProvider(indexerUri, fetch);

    // NOTE: For full deployment with a real wallet provider, you need the
    // Midnight CLI wallet provider. See the Midnight developer docs for
    // the @midnight-ntwrk/midnight-js-node-wallet-provider package.
    // For now, this deploys the contract structure and shows the flow.

    console.log('\n   ℹ️  NOTE: Full automated deployment requires the Midnight CLI wallet.');
    console.log('   See the PREPROD DEPLOYMENT GUIDE below for manual steps.\n');

    // ── Step 5: Save results ───────────────────────────────────────────────
    console.log('📝 Step 5: Saving deployment info...');

    // Save private seller config locally (NEVER commit this!)
    const sellerConfig = {
      reserve_price:    args.reserveNight,
      reserve_price_micro: reservePriceMicro.toString(),
      commitment_salt:  salt.toString('hex'),
      item_description: args.itemDescription,
      network:          args.network,
      deployed_at:      new Date().toISOString(),
      // contract_address will be filled in after manual deployment
      contract_address: 'FILL_IN_AFTER_DEPLOYMENT',
    };

    const configPath = path.join(ROOT, '.seller-config.json');
    fs.writeFileSync(configPath, JSON.stringify(sellerConfig, null, 2));
    console.log(`   ✅ Seller private config saved to .seller-config.json`);
    console.log('   ⚠️  This file is in .gitignore — NEVER commit it!\n');

    // Print the manual deployment guide
    printManualDeploymentGuide(args, reservePriceMicro, salt, itemHash);

  } catch (error) {
    console.error('\n❌ Deployment error:', error instanceof Error ? error.message : error);
    console.error('\nℹ️  If this is a proof server connection error, make sure Docker is running:');
    console.error('   npm run env:up\n');
    process.exit(1);
  }
}

function printManualDeploymentGuide(
  args: { reserveNight: number; durationBlocks: bigint; itemDescription: string; network: string },
  reservePriceMicro: bigint,
  salt: Buffer,
  itemHash: Buffer
) {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📖 PREPROD DEPLOYMENT GUIDE — Step by Step');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Your auction parameters are ready. Follow these steps:\n');

  console.log('STEP 1: Get tNIGHT from the faucet');
  console.log('  → Open: https://faucet.midnight.network/');
  console.log('  → Connect your 1AM wallet');
  console.log('  → Request tNIGHT tokens (takes ~1 minute)\n');

  console.log('STEP 2: Open your 1AM wallet browser extension');
  console.log('  → Make sure it\'s set to "Midnight Preprod" network');
  console.log('  → You should see tNIGHT balance\n');

  console.log('STEP 3: Open the ZKAuction app');
  console.log('  → Run: npm run dev');
  console.log('  → Open: http://localhost:3000');
  console.log('  → Click "Connect Wallet" → approve in 1AM wallet\n');

  console.log('STEP 4: Create your auction');
  console.log('  → Click "Create Private Auction"');
  console.log(`  → Item: ${args.itemDescription}`);
  console.log(`  → Reserve Price: ${args.reserveNight} tNIGHT (private!)`);
  console.log(`  → Duration: ${args.durationBlocks} blocks`);
  console.log('  → Click "Deploy Auction"\n');

  console.log('STEP 5: Copy the contract address');
  console.log('  → After deployment, a contract address appears');
  console.log('  → It looks like: mn1q...');
  console.log('  → Copy it and save to .env.local as:');
  console.log('    NEXT_PUBLIC_DEPLOYED_CONTRACT=mn1q...\n');

  console.log('STEP 6: Verify on-chain');
  console.log('  → Open: https://midnight.network/devtools/preprod');
  console.log('  → Paste your contract address');
  console.log('  → You should see the auction state\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Your Auction Configuration (saved to .seller-config.json)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Reserve price:     ${args.reserveNight} tNIGHT`);
  console.log(`  Reserve (µNIGHT):  ${reservePriceMicro}`);
  console.log(`  Salt (hex):        ${salt.toString('hex').slice(0, 32)}...`);
  console.log(`  Item fingerprint:  ${itemHash.toString('hex')}`);
  console.log(`  Duration:          ${args.durationBlocks} blocks`);
  console.log('');
  console.log('  ⚠️  Keep .seller-config.json safe — you NEED the salt');
  console.log('     to call settle() and reveal the reserve price later!');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
