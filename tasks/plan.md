# Implementation Plan: HostMyBot MCP Server

## Overview
Build a TypeScript/Node.js Model Context Protocol (MCP) server (`hostmybot-mcp`) that exposes the full Pterodactyl Client API (`/api/client`) for HostMyBot (`https://client.hostmybot.net`). The server runs over `stdio` and accepts the client API key (`ptlc_...`) via environment variables (`HOSTMYBOT_API_KEY`, `HOSTMYBOT_URL`) or CLI flags (`--api-key`, `--url`), making it plug-and-play across Antigravity, Claude Code, Codex, Cursor, and other MCP clients.

## Architecture Decisions
- **Runtime & SDK:** TypeScript + Node.js (>=18, native `fetch` and `FormData`) using `@modelcontextprotocol/sdk` and `zod` for strict input schema validation.
- **Transport & Agent Configuration:** Standard `stdio` transport. Agents configure the server via standard `mcpServers` JSON (`env.HOSTMYBOT_API_KEY` + optional `env.HOSTMYBOT_URL` defaulting to `https://client.hostmybot.net`), with `--api-key` and `--url` CLI flags supported as fallback.
- **API Client (`src/client.ts`):** Centralized HTTP wrapper around `/api/client` that injects `Authorization: Bearer <key>` and `Accept: application/json`, handles `204 No Content` responses, and translates Pterodactyl `errors[]` payloads into readable `Error` messages.
- **Vertical Tool Modules (`src/tools/`):** Tools are grouped by domain (`servers`, `files`, `settings`, `automation`, `account`) and registered cleanly on the `McpServer` instance.
- **Two-Step File Upload:** `upload_file` calls `GET /api/client/servers/{id}/files/upload` to obtain a signed Wings URL, reads the local file from disk, and `POST`s it as `multipart/form-data` directly to Wings.
- **Testing:** `vitest` with mocked `fetch` responses for every tool and client edge case, plus `tsc --noEmit` / `npm run build` verification.

## Dependency Graph
```
Task 1: Project Scaffolding & Config Loader (env + CLI args)
    │
    └── Task 2: Pterodactyl HTTP Client (src/client.ts)
            │
            ├── Task 3: Servers, Resources, Power & Console Tools
            ├── Task 4: File Listing, Reading, Writing & Archive Tools
            │       └── Task 5: File Upload (Signed URL) & Download Tools
            ├── Task 6: Startup Variables, Settings & Network Tools
            ├── Task 7: Backups & Schedules (Cron) Tools
            └── Task 8: Subusers, Account Tools & Agent Setup Docs
```

## Task List

### Phase 1: Foundation
- [x] Task 1: Scaffold TypeScript project, MCP server entrypoint, and config loader
- [x] Task 2: Implement Pterodactyl Client API HTTP wrapper with error handling

### Checkpoint: Foundation
- [x] `npm run build` and `npm test` pass; server starts over `stdio` and validates missing API key cleanly

### Phase 2: Core Server & File Tools
- [x] Task 3: Implement server list, details, resources, power, and console command tools
- [x] Task 4: Implement file list, read, write, create folder, rename, copy, delete, compress, decompress tools
- [x] Task 5: Implement two-step file upload (`multipart/form-data`) and download URL tools

### Checkpoint: Core Server & File Tools
- [x] All core tool tests pass; manual smoke test against panel verifies listing servers, resources, and files

### Phase 3: Advanced Panel Features & Packaging
- [x] Task 6: Implement startup variables, server rename/reinstall, and network allocations tools
- [x] Task 7: Implement backups and schedules (cron) tools
- [x] Task 8: Implement subusers, account tools, `bin` entry, and `README.md` with Antigravity/Claude Code/Codex configs

### Checkpoint: Complete
- [x] Full test suite and TypeScript build pass with zero errors
- [x] MCP server verified end-to-end via MCP client config

### Phase 4: Full HostMyBot / Pterodactyl Client API Coverage (Tasks 9–14)
- [x] Task 9: Add live WebSocket console credentials and log reader (`get_websocket_credentials`, `get_console_logs`)
- [x] Task 10: Add system permissions and account/server activity audit logs
- [x] Task 11: Add server database management module (`src/tools/databases.ts`)
- [x] Task 12: Add remote file pull (`files/pull`) and full network allocation CRUD
- [x] Task 13: Add update/get/lock tools for schedules, schedule tasks, backups, and subusers
- [x] Task 14: Add account API keys & SSH keys tools and update `README.md` catalog

### Checkpoint: Full API Coverage
- [x] Full test suite and TypeScript build pass with zero errors
- [x] Live read-only smoke test verifies new endpoints (`list_permissions`, `get_console_logs`, `get_account_activity`, `list_api_keys`)

## Risks & Mitigations
- **Wings CORS / Signed Upload URLs:** Wings upload URLs expect `multipart/form-data` with field name `files` and optional `?directory=...` query param. Test this explicitly in Task 5.
- **Destructive Actions:** Tools like `reinstall_server`, `delete_files`, `delete_backup`, `delete_database`, `delete_api_key`, and `power` (`kill`/`stop`) can cause data loss or downtime; mark them clearly in tool descriptions so agents confirm intent before invoking.
- **Wings WebSocket Console (`get_console_logs`):** Wings requires sending an `Origin` header matching the panel URL (`https://client.hostmybot.net`) when upgrading to WebSocket, and outputs ANSI color codes. Strip ANSI sequences by default and bound connection time with a short idle/timeout window.
- **Rate Limits:** Pterodactyl defaults to 300 req/min (`X-RateLimit-Remaining`). Surface `429` status clearly in `src/client.ts`.
