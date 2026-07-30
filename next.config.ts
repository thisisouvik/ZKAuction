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
    '@midnight-ntwrk/compact-js/effect',
    '@midnight-ntwrk/midnight-js-level-private-state-provider',
  ],

  // ── Static file headers ────────────────────────────────────────────────────
  // Serve the compiled ZK key files (.prover, .verifier) from /public/keys/
  // and ZKIR files (.bzkir) from /public/zkir/ with the correct binary
  // content-type so FetchZkConfigProvider can fetch them via HTTP.
  async headers() {
    return [
      {
        source: '/keys/:file*',
        headers: [
          { key: 'Content-Type', value: 'application/octet-stream' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/zkir/:file*',
        headers: [
          { key: 'Content-Type', value: 'application/octet-stream' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

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
