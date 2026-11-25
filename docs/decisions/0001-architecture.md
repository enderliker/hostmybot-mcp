# ADR-0001: HostMyBot MCP Server Architecture

## Status
Accepted

## Date
2026-11-25

## Context
We need a Model Context Protocol (MCP) server for the HostMyBot / Pterodactyl Client API (`/api/client`) that works across AI coding agents (Antigravity, Claude Code, Codex, Cursor), supports full server and filesystem management including binary uploads and live console reading, and minimizes LLM context token consumption.

## Decision
1. **TypeScript + `@modelcontextprotocol/sdk` over `stdio`:** Use `StdioServerTransport` configured via `HOSTMYBOT_API_KEY` / `HOSTMYBOT_URL` environment variables (with `--api-key` / `--url` CLI fallback) so every MCP client can inject credentials in its standard `mcpServers` block.
2. **Response Compaction (`src/format.ts`):** Strip Pterodactyl list/attribute wrapper envelopes, null/empty fields, and verbose startup bash scripts; format byte counts into human-readable units; cap `read_file_contents` at `50000` characters by default.
3. **`ws` with explicit `Origin` header for Wings WebSocket (`get_console_logs`):** Node's standard global `WebSocket` treats its second parameter as `protocols` rather than request headers, causing Wings to reject upgrades missing `Origin`. Using `ws` with `{ headers: { Origin: baseUrl } }` works reliably across Node >= 18.

## Consequences
- Zero external config files or daemon processes required; each agent spawns its own isolated `stdio` process.
- Full unit + protocol coverage via `InMemoryTransport` and injectable `fetch` / `wsFactory`.
- Agents receive concise JSON payloads, avoiding context bloat on large server or file listings.
