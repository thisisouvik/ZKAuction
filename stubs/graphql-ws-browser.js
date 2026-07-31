// Browser stub for graphql-ws
// In the browser, WebSocket connections to the Midnight indexer are handled
// via the native browser WebSocket API, not the Node.js graphql-ws package.
// This stub allows the import to succeed; the actual WS connection is
// established at runtime using the browser's built-in WebSocket.

function createClient(opts) {
  // Use the browser's native WebSocket
  const ws = new WebSocket(opts.url);
  return {
    subscribe: function(payload, sink) {
      ws.onopen = function() {
        ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
        ws.send(JSON.stringify({ type: 'subscribe', id: '1', payload }));
      };
      ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        if (msg.type === 'next') sink.next(msg.payload);
        if (msg.type === 'error') sink.error(msg.payload);
        if (msg.type === 'complete') sink.complete();
      };
      ws.onerror = function(e) { sink.error(e); };
      return function() { ws.close(); };
    },
    dispose: function() { ws.close(); },
  };
}

module.exports = { createClient };
module.exports.createClient = createClient;
