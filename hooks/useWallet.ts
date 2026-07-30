'use client';

/**
 * hooks/useWallet.ts — 1AM Wallet Connection Hook
 *
 * The 1AM wallet injects at window.midnight['1am'].
 * Its API is NOT the standard Cardano .enable() API.
 * We probe the available methods and use whatever works.
 */

import { useState, useEffect, useCallback } from 'react';
import type { MidnightWalletConnector } from '@/lib/providers';

export interface WalletHookState {
  isConnecting: boolean;
  isConnected: boolean;
  isPendingError: boolean;       // true when wallet threw "already pending"
  address: string | null;
  shortAddress: string | null;
  error: string | null;
  connector: MidnightWalletConnector | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  resetAndReconnect: () => void; // clears the pending error and retries
  debugInfo: string | null;
}

/**
 * Known injection keys in priority order.
 * The 1AM wallet uses '1am' (confirmed from debug output).
 */
const PRIORITY_KEYS = ['1am', 'mn1am', 'mnLace', 'mn_1am', 'wallet'];

/**
 * Get the raw wallet object from window.midnight.
 * Does NOT filter by .enable() — the 1AM wallet may use a different API.
 */
function getRawWallet(): { wallet: any; key: string } | null {
  const midnight = (window as any)?.midnight;
  if (!midnight || typeof midnight !== 'object') return null;

  const allKeys = Object.keys(midnight);
  console.log('[ZKAuction] window.midnight keys:', allKeys);

  // Try priority keys first
  for (const key of PRIORITY_KEYS) {
    if (midnight[key] && typeof midnight[key] === 'object') {
      console.log(`[ZKAuction] Found wallet at window.midnight['${key}']`);
      console.log(`[ZKAuction] Methods available:`, Object.keys(midnight[key]));
      return { wallet: midnight[key], key };
    }
  }

  // Fallback: grab first non-null object key
  for (const key of allKeys) {
    if (midnight[key] && typeof midnight[key] === 'object') {
      console.log(`[ZKAuction] Fallback: using window.midnight['${key}']`);
      console.log(`[ZKAuction] Methods available:`, Object.keys(midnight[key]));
      return { wallet: midnight[key], key };
    }
  }

  return null;
}

/**
 * Try every known connection method on the wallet object.
 * The 1AM wallet may use .enable(), .connect(), .requestAccounts(), or similar.
 */
async function connectToWallet(wallet: any, key: string): Promise<MidnightWalletConnector> {
  const methods = Object.keys(wallet).filter(k => typeof wallet[k] === 'function');
  console.log(`[ZKAuction] wallet['${key}'] methods:`, methods);

  // Try standard dApp connector API first
  if (typeof wallet.enable === 'function') {
    console.log('[ZKAuction] Using .enable()');
    const result = await wallet.enable();
    console.log('[ZKAuction] Raw result of .enable():', result);
    try {
      const allProps = [];
      let obj = result;
      while (obj) {
        allProps.push(...Object.getOwnPropertyNames(obj));
        obj = Object.getPrototypeOf(obj);
      }
      console.log('[ZKAuction] All prototype properties of enable result:', [...new Set(allProps)]);
    } catch (e) {
      console.error(e);
    }
    
    // If it returns an object that actually has connector methods, use it
    if (result && typeof result === 'object' && (typeof result.state === 'function' || typeof result.address === 'function' || typeof result.getChangeAddress === 'function' || typeof result.balanceTx === 'function' || typeof result.getShieldedAddresses === 'function')) {
      return result;
    }
    
    // Let's also check if it returns a string (maybe the address?)
    if (typeof result === 'string') {
      console.log('[ZKAuction] .enable() returned a string, possibly address:', result);
      return { address: () => result } as any;
    }

    // Otherwise, .enable() just unlocked the wallet; the wallet object itself IS the connector
    console.log('[ZKAuction] .enable() returned an object without connector methods, using wallet itself as connector');
    
    try {
      const allPropsW = [];
      let objW = wallet;
      while (objW) {
        allPropsW.push(...Object.getOwnPropertyNames(objW));
        objW = Object.getPrototypeOf(objW);
      }
      console.log('[ZKAuction] All prototype properties of wallet object:', [...new Set(allPropsW)]);
    } catch (e) {}

    return wallet as MidnightWalletConnector;
  }

  // Try .connect()
  if (typeof wallet.connect === 'function') {
    console.log('[ZKAuction] Using .connect()');
    // Pass the EXACT network ID string — must match what the 1AM wallet expects.
    // Set NEXT_PUBLIC_MIDNIGHT_NETWORK in .env.local to 'preview', 'preprod', or 'devnet'.
    const networkId = (process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK ?? 'preview').toLowerCase();
    console.log('[ZKAuction] Connecting to network:', networkId);
    const result = await wallet.connect(networkId);
    if (result && typeof result === 'object') return result;
    return result;
  }

  // Try .requestAccounts()
  if (typeof wallet.requestAccounts === 'function') {
    console.log('[ZKAuction] Using .requestAccounts()');
    return await wallet.requestAccounts();
  }

  // Try .getConnector()
  if (typeof wallet.getConnector === 'function') {
    console.log('[ZKAuction] Using .getConnector()');
    return await wallet.getConnector();
  }

  // Try .api() — some wallets expose this
  if (typeof wallet.api === 'function') {
    console.log('[ZKAuction] Using .api()');
    return await wallet.api();
  }

  // If wallet object itself is the connector (has address / state methods)
  if (typeof wallet.address === 'function' || typeof wallet.balances === 'function' || typeof wallet.state === 'function') {
    console.log('[ZKAuction] Wallet object IS the connector');
    return wallet as MidnightWalletConnector;
  }

  throw new Error(
    `1AM wallet found at window.midnight['${key}'] but no known connect method found.\n` +
    `Available methods: [${methods.join(', ')}]\n` +
    `Please check console for details and report this to the dev team.`
  );
}

/**
 * Get wallet address from connector — handles multiple API shapes.
 */
async function getAddress(conn: any): Promise<string | null> {
  try {
    const extractString = (res: any): string | null => {
      if (!res) return null;
      if (typeof res === 'string') return res;
      if (Array.isArray(res) && res.length > 0) {
        if (typeof res[0] === 'string') return res[0];
        if (res[0] && typeof res[0].shieldedAddress === 'string') return res[0].shieldedAddress;
        if (res[0] && typeof res[0].unshieldedAddress === 'string') return res[0].unshieldedAddress;
      }
      if (typeof res.shieldedAddress === 'string') return res.shieldedAddress;
      if (typeof res.unshieldedAddress === 'string') return res.unshieldedAddress;
      return null;
    };

    if (typeof conn.address === 'function') return extractString(await conn.address());
    if (typeof conn.getAddress === 'function') return extractString(await conn.getAddress());
    if (typeof conn.getChangeAddress === 'function') return extractString(await conn.getChangeAddress());
    if (typeof conn.getShieldedAddresses === 'function') {
      try {
        const rawRes = await conn.getShieldedAddresses();
        const result = extractString(rawRes);
        if (result) return result;
        throw new Error(`getShieldedAddresses returned: ${JSON.stringify(rawRes, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
      } catch (e: any) {
        console.warn('[ZKAuction] Wallet API Error:', e.message);
      }
    }
    if (typeof conn.getUnshieldedAddress === 'function') {
      const result = extractString(await conn.getUnshieldedAddress());
      if (result) return result;
    }
    if (typeof conn.state === 'function') {
      const s = await conn.state();
      return s?.address ?? s?.coinPublicKey ?? null;
    }
    if (conn.address && typeof conn.address === 'string') return conn.address;
  } catch (e) {
    console.warn('[ZKAuction] Could not get address:', e);
  }
  return null;
}

/**
 * Poll for wallet injection until found or timeout.
 */
async function waitForWallet(timeoutMs: number): Promise<{ wallet: any; key: string } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = getRawWallet();
    if (found) return found;
    await sleep(300);
  }
  return getRawWallet();
}

export function useWallet(): WalletHookState {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isPendingError, setIsPendingError] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [connector, setConnector] = useState<MidnightWalletConnector | null>(null);

  const shortAddress = address
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : null;

  // Auto-reconnect on mount
  useEffect(() => {
    const checkExistingConnection = async () => {
      const found = getRawWallet();
      if (!found) return;
      try {
        // Only auto-reconnect if already enabled
        if (typeof found.wallet.isEnabled === 'function') {
          const already = await found.wallet.isEnabled();
          if (!already) return;
        }
        const conn = await connectToWallet(found.wallet, found.key);
        const addr = await getAddress(conn);
        setConnector(conn as MidnightWalletConnector);
        setAddress(addr);
        setIsConnected(true);
      } catch {
        // Silently ignore — user hasn't connected yet
      }
    };

    const t = setTimeout(checkExistingConnection, 1000);
    return () => clearTimeout(t);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setDebugInfo(null);
    setIsConnecting(true);

    try {
      // Log everything in window.midnight for diagnosis
      const mid = (window as any)?.midnight;
      console.log('[ZKAuction] window.midnight:', mid);
      if (mid) {
        for (const k of Object.keys(mid)) {
          const obj = mid[k];
          console.log(`[ZKAuction] .${k} (${typeof obj}):`, obj);
          if (obj && typeof obj === 'object') {
            console.log(`[ZKAuction]   keys of .${k}:`, Object.keys(obj));
          }
        }
      }

      setDebugInfo('Looking for 1AM wallet...');
      const found = await waitForWallet(10000);

      if (!found) {
        const keys = mid ? Object.keys(mid) : [];
        throw new Error(
          `1AM wallet not found in window.midnight.\n` +
          `Keys present: [${keys.join(', ') || 'none'}]\n` +
          `Make sure the 1AM extension is installed, unlocked, and set to Preprod.`
        );
      }

      setDebugInfo(`Connecting via window.midnight['${found.key}']...`);
      const conn = await connectToWallet(found.wallet, found.key);

      const addr = await getAddress(conn);
      setConnector(conn as MidnightWalletConnector);
      setAddress(addr);
      setIsConnected(true);
      setDebugInfo(null);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet connection failed';
      console.error('[ZKAuction] Connection error:', err);
      // Detect the "already pending" error specifically so the UI can show a retry button
      const isPending = msg.toLowerCase().includes('already pending');
      setIsPendingError(isPending);
      setError(msg);
      setDebugInfo(null);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Clears the "already pending" state and triggers a fresh connection attempt.
   * The 1AM wallet holds a pending flag internally — there is no JS API to clear it,
   * but dismissing the extension popup (or waiting ~30 s) resets it on the wallet side.
   * This function simply resets our local state so the user can try again cleanly.
   */
  const resetAndReconnect = useCallback(() => {
    setError(null);
    setDebugInfo(null);
    setIsPendingError(false);
    setIsConnecting(false);
    // Small delay so the user can dismiss the wallet popup before we call connect again
    setTimeout(() => connect(), 300);
  }, [connect]);

  const disconnect = useCallback(() => {
    setConnector(null);
    setAddress(null);
    setIsConnected(false);
    setError(null);
    setIsPendingError(false);
    setDebugInfo(null);
  }, []);

  return {
    isConnecting,
    isConnected,
    isPendingError,
    address,
    shortAddress,
    error,
    debugInfo,
    connector,
    connect,
    disconnect,
    resetAndReconnect,
  };
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
