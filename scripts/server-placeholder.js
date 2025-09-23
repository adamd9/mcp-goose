#!/usr/bin/env node

// Temporary placeholder server so `npm start` works end-to-end.
// In the next step, this will be replaced by the actual MCP server bootstrap.

console.log("mcp-goose: starting (placeholder server)\n" +
  "- Preflight checks completed.\n" +
  "- This is a temporary process to keep `npm start` running.\n" +
  "- Replace with the real MCP server entrypoint during implementation.");

// Keep the process alive to simulate a running server
setInterval(() => {}, 1 << 30);
