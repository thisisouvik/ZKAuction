/**
 * lib/index.ts — Barrel export for the ZKAuction API layer
 *
 * Import everything from here in your Next.js components:
 *   import { AuctionAPI, connectWallet, AuctionStatus } from '@/lib';
 */

export { AuctionAPI } from './auction-api';
export { connectWallet, buildProviders, getNetworkConfig, PREPROD_CONFIG, DEVNET_CONFIG } from './providers';
export {
  AuctionStatus,
  AuctionApiError,
  AuctionErrorCode,
  type AuctionState,
  type CreateAuctionParams,
  type PlaceBidParams,
  type TxResult,
  type SellerPrivateConfig,
  type MidnightNetworkConfig,
  type WalletState,
} from './types';
