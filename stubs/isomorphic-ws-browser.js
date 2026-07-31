// Browser stub for isomorphic-ws
// In a browser context, we use the native WebSocket API.
// This stub is only used when Turbopack builds the client bundle.
// The real isomorphic-ws is used on the server side.

const WebSocket = globalThis.WebSocket || class NoopWebSocket {};
module.exports = WebSocket;
module.exports.default = WebSocket;
module.exports.WebSocket = WebSocket;
