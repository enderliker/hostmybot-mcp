#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PterodactylClient } from "./client.js";
import { isHelpRequested, loadConfig } from "./config.js";
import { registerAccountTools } from "./tools/account.js";
import { registerAutomationTools } from "./tools/automation.js";
import { registerFileTools } from "./tools/files.js";
import { registerServerTools } from "./tools/servers.js";
import { registerSettingsTools } from "./tools/settings.js";

function printHelp(): void {
  console.error(
    [
      "hostmybot-mcp - HostMyBot / Pterodactyl Client API MCP Server (stdio)",
      "",
      "Configuration (via env vars or CLI flags):",
      "  HOSTMYBOT_API_KEY / --api-key <ptlc_...>   Required Pterodactyl Client API key",
      "  HOSTMYBOT_URL     / --url <https://...>    Optional panel URL (default: https://client.hostmybot.net)",
    ].join("\n"),
  );
}

export function createHostMyBotServer(client: PterodactylClient): McpServer {
  const server = new McpServer({
    name: "hostmybot-mcp",
    version: "1.0.0",
  });

  registerServerTools(server, client);
  registerFileTools(server, client);
  registerSettingsTools(server, client);
  registerAutomationTools(server, client);
  registerAccountTools(server, client);

  return server;
}

async function main(): Promise<void> {
  if (isHelpRequested()) {
    printHelp();
    process.exit(0);
  }

  const config = loadConfig();
  const client = new PterodactylClient(config);
  const server = createHostMyBotServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? (() => {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
})() : undefined;

if (entryFile === currentFile) {
  main().catch((err) => {
    console.error("[hostmybot-mcp]", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
