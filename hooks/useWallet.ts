'use client';

/**
 * hooks/useWallet.ts — 1AM Wallet Connection Hook
 *
 * Manages the lifecycle of connecting to the 1AM wallet browser extension.
 * The 1AM wallet injects itself as window.midnight.mnLace
 * (mnLace is the Midnight Network dApp connector API standard key).
 *
 * State managed:
 *  - isConnecting: spinner shown during wallet.enable()
 *  - isConnected:  true once the connector is available
 *  - address:      the wallet's Midnight payment address
 *  - error:        human-readable error string if connection failed
 *  - connector:    the raw MidnightWalletConnector (passed to AuctionAPI)
 */

import { useState, useEffect, useCallback } from 'react';
import type { MidnightWalletConnector } from '@/lib/providers';

export interface WalletHookState {
  isConnecting: boolean;
  isConnected: boolean;
  address: string | null;
  shortAddress: string | null;
  error: string | null;
  connector: MidnightWalletConnector | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletHookState {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connector, setConnector] = useState<MidnightWalletConnector | null>(null);

  // Shorten a Midnight address for display: abcd…wxyz
  const shortAddress = address
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : null;

  // Auto-reconnect if wallet was previously connected in this session
  useEffect(() => {
    const checkExistingConnection = async () => {
      const wallet = (window as any)?.midnight?.mnLace;
      if (!wallet) return;
      try {
        const already = await wallet.isEnabled();
        if (already) {
          const conn = await wallet.enable();
          const addr = await conn.address();
          setConnector(conn);
          setAddress(addr);
          setIsConnected(true);
        }
      } catch {
        // Silently ignore — user hasn't connected yet
      }
    };

    // Small delay so the wallet extension has time to inject into window
    const t = setTimeout(checkExistingConnection, 600);
    return () => clearTimeout(t);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // Wait for wallet injection (up to 4 seconds)
      const wallet = await waitForWallet(4000);

      if (!wallet) {
        throw new Error(
          '1AM wallet not detected. Please install the 1AM wallet extension, ' +
          'make sure it is unlocked, and refresh this page.'
        );
      }

      const conn = await wallet.enable();
      const addr = await conn.address();

      setConnector(conn);
      setAddress(addr);
      setIsConnected(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet connection failed';
      setError(msg);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnector(null);
    setAddress(null);
    setIsConnected(false);
    setError(null);
  }, []);

  return {
    isConnecting,
    isConnected,
    address,
    shortAddress,
    error,
    connector,
    connect,
    disconnect,
  };
}

async function waitForWallet(timeoutMs: number): Promise<any | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const w = (window as any)?.midnight?.mnLace;
    if (w) return w;
    await sleep(150);
  }
  return (window as any)?.midnight?.mnLace ?? null;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
