import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // ── Midnight SDK Node.js exclusions ────────────────────────────────────────
  // The Midnight provider packages use Node.js-only modules (WebSocket, RxJS,
  // graphql-ws with isomorphic-ws). These must never be included in the
  // browser bundle — they are dynamically imported from client components only
  // at runtime, so webpack/Turbopack must be told to leave them alone.
  serverExternalPackages: [
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
    '@midnight-ntwrk/midnight-js-http-client-proof-provider',
    '@midnight-ntwrk/midnight-js-fetch-zk-config-provider',
    '@midnight-ntwrk/midnight-js-contracts',
    '@midnight-ntwrk/compact-runtime',
    '@midnight-ntwrk/compact-js',
  ],

  // Turbopack alias for browser (replaces Node.js-only ws with empty stub)
  turbopack: {
    resolveAlias: {
      'isomorphic-ws': { browser: './stubs/isomorphic-ws-browser.js' },
      'graphql-ws':    { browser: './stubs/graphql-ws-browser.js' },
    },
  },
};

export default nextConfig;
