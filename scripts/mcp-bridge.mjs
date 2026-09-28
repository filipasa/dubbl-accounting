#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DUBBL_URL = process.env.DUBBL_URL || "http://localhost:3001/api/mcp";
const DUBBL_TOKEN =
  process.env.DUBBL_TOKEN ||
  "mcp_at_90318ca773b0007f616d54b696a2961a0b676d6abdc7a063";

const stdio = new StdioServerTransport();
const http = new StreamableHTTPClientTransport(new URL(DUBBL_URL), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${DUBBL_TOKEN}`,
    },
  },
});

stdio.onmessage = (msg) => {
  http.send(msg).catch((err) => {
    console.error("[MCP Bridge] failed to forward to HTTP:", err);
  });
};

http.onmessage = (msg) => {
  stdio.send(msg).catch((err) => {
    console.error("[MCP Bridge] failed to forward to stdio:", err);
  });
};

stdio.onerror = (err) => {
  console.error("[MCP Bridge stdio error]", err);
};

http.onerror = (err) => {
  console.error("[MCP Bridge http error]", err);
};

stdio.onclose = () => {
  http.close().catch(() => {});
};

http.onclose = () => {
  stdio.close().catch(() => {});
};

await Promise.all([stdio.start(), http.start()]);
