import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // ── Midnight SDK — keep these out of the SSR bundle ───────────────────────
  // These packages use Node.js APIs (level-db, native WebSocket, RxJS) that
  // cannot run during Next.js SSR. We exclude them from the server bundle
  // and import them dynamically only in client components.
  serverExternalPackages: [
    '@midnight-ntwrk/midnight-js-contracts',
    '@midnight-ntwrk/compact-runtime',
    '@midnight-ntwrk/compact-js',
    '@midnight-ntwrk/midnight-js-level-private-state-provider',
  ],

  // ── Turbopack browser aliases ──────────────────────────────────────────────
  // Replace Node.js-only packages with browser-compatible implementations
  // when building the client bundle.
  turbopack: {
    resolveAlias: {
      // isomorphic-ws → browser native WebSocket
      'isomorphic-ws': { browser: './stubs/isomorphic-ws-browser.js' },
      // graphql-ws → browser native WebSocket client implementation
      'graphql-ws': { browser: './stubs/graphql-ws-browser.js' },
    },
  },

  // ── Webpack browser aliases (used in production builds) ───────────────────
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'isomorphic-ws': require.resolve('./stubs/isomorphic-ws-browser.js'),
        'graphql-ws': require.resolve('./stubs/graphql-ws-browser.js'),
      };
    }
    return config;
  },
};

export default nextConfig;
