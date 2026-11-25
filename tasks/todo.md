# Task List: HostMyBot MCP Server

## Task 1: Scaffold TypeScript project, MCP server entrypoint, and config loader

**Description:** Initialize `/home/ender/projects/hostmybot-mcp` with `package.json`, `tsconfig.json`, `vitest.config.ts`, and a config loader (`src/config.ts`) that reads `HOSTMYBOT_API_KEY` and `HOSTMYBOT_URL` (default `https://client.hostmybot.net`) from environment variables or CLI flags (`--api-key`, `--url`), plus the `McpServer` `stdio` entrypoint (`src/index.ts`).

**Acceptance criteria:**
- [x] `package.json` includes `@modelcontextprotocol/sdk`, `zod`, `typescript`, `vitest`, `@types/node`, and `bin` entry (`hostmybot-mcp`)
- [x] `src/config.ts` resolves API key and normalized base URL (stripping trailing slashes) from env or CLI args, throwing a clear error if API key is missing
- [x] `src/index.ts` initializes `McpServer` and connects `StdioServerTransport`

**Verification:**
- [x] Tests pass: `npm test -- config`
- [x] Build succeeds: `npm run build`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `src/config.ts`
- `src/index.ts`
- `tests/config.test.ts`

**Estimated scope:** Medium (4-5 files)

---

## Task 2: Implement Pterodactyl Client API HTTP wrapper with error handling

**Description:** Create `src/client.ts` providing a typed `PterodactylClient` class with `request<T>(method, path, options)` supporting JSON bodies, query params, plain-text responses (for `/files/contents` and `/files/write`), `204 No Content`, and Pterodactyl `errors[]` parsing.

**Acceptance criteria:**
- [x] Sends `Authorization: Bearer <apiKey>` and `Accept: application/json` on every request
- [x] Handles `204 No Content`, JSON responses, and raw text responses cleanly
- [x] Formats HTTP 4xx/5xx (including `429` rate limits and Pterodactyl `errors[0].detail`) into descriptive `Error` messages

**Verification:**
- [x] Tests pass: `npm test -- client`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 1

**Files likely touched:**
- `src/client.ts`
- `tests/client.test.ts`

**Estimated scope:** Small (2 files)

---

## Checkpoint: After Tasks 1-2
- [x] All tests pass (`npm test`)
- [x] Project builds cleanly (`npm run build`)

---

## Task 3: Implement server list, details, resources, power, and console command tools

**Description:** Create `src/tools/servers.ts` registering MCP tools for listing servers (`list_servers`), getting server details (`get_server`), checking live CPU/RAM/disk/network resources (`get_server_resources`), sending power signals (`send_power_signal`: `start`, `stop`, `restart`, `kill`), and sending console commands (`send_console_command`).

**Acceptance criteria:**
- [x] All 5 tools registered with `zod` schemas and clear descriptions
- [x] Power signals validated against `["start", "stop", "restart", "kill"]`
- [x] Unit tests verify exact endpoints, HTTP methods, and payloads

**Verification:**
- [x] Tests pass: `npm test -- servers`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/tools/servers.ts`
- `src/index.ts`
- `tests/tools/servers.test.ts`

**Estimated scope:** Small (2-3 files)

---

## Task 4: Implement file listing, reading, writing, and filesystem operations tools

**Description:** Create `src/tools/files.ts` registering tools for `list_files`, `read_file_contents`, `write_file`, `create_folder`, `rename_files`, `copy_file`, `delete_files`, `compress_files`, `decompress_file`, and `chmod_files`.

**Acceptance criteria:**
- [x] Handles URL encoding for `file` and `directory` query parameters
- [x] `write_file` sends raw text body to `POST /api/client/servers/{id}/files/write?file=...`
- [x] `delete_files`, `rename_files`, `compress_files`, and `chmod_files` send expected JSON payloads

**Verification:**
- [x] Tests pass: `npm test -- files`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/tools/files.ts`
- `src/index.ts`
- `tests/tools/files.test.ts`

**Estimated scope:** Medium (3 files)

---

## Task 5: Implement two-step file upload (`multipart/form-data`) and download URL tools

**Description:** Extend `src/tools/files.ts` with `upload_file` (reads a local file path, fetches signed URL from `GET /api/client/servers/{id}/files/upload`, and `POST`s `FormData` with `files` field and target `directory` query param) and `get_download_url` (`GET /api/client/servers/{id}/files/download`).

**Acceptance criteria:**
- [x] `upload_file` validates that the local file exists before requesting the signed upload URL
- [x] Appends `&directory=<targetDir>` to the signed Wings upload URL when uploading to a subdirectory
- [x] Mocked `fetch` test verifies the 2-step flow and `FormData` payload

**Verification:**
- [x] Tests pass: `npm test -- files`
- [x] Build succeeds: `npm run build`
- [x] Manual check: list servers & files against panel API

**Dependencies:** Task 4

**Files likely touched:**
- `src/tools/files.ts`
- `src/client.ts`
- `tests/tools/files.test.ts`

**Estimated scope:** Small (2-3 files)

---

## Checkpoint: After Tasks 3-5
- [x] All tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)
- [x] Core server & file operations verified

---

## Task 6: Implement startup variables, server settings, and network allocations tools

**Description:** Create `src/tools/settings.ts` registering `get_startup_variables`, `update_startup_variable`, `rename_server`, `reinstall_server`, `set_docker_image`, and `list_allocations`.

**Acceptance criteria:**
- [x] `update_startup_variable` sends `{ key, value }` to `PUT /api/client/servers/{id}/startup/variable`
- [x] `reinstall_server` clearly warns in its description that it is destructive
- [x] Unit tests cover all 6 tools

**Verification:**
- [x] Tests pass: `npm test -- settings`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/tools/settings.ts`
- `src/index.ts`
- `tests/tools/settings.test.ts`

**Estimated scope:** Small (2-3 files)

---

## Task 7: Implement backups and schedules (cron) tools

**Description:** Create `src/tools/automation.ts` registering backup tools (`list_backups`, `create_backup`, `get_backup_download_url`, `restore_backup`, `delete_backup`) and schedule tools (`list_schedules`, `create_schedule`, `delete_schedule`, `create_schedule_task`, `execute_schedule`).

**Acceptance criteria:**
- [x] `create_schedule` accepts standard Pterodactyl cron fields (`minute`, `hour`, `day_of_month`, `month`, `day_of_week`) and `is_active` / `only_when_online`
- [x] `restore_backup` supports `truncate` boolean parameter
- [x] Unit tests verify endpoints and payloads

**Verification:**
- [x] Tests pass: `npm test -- automation`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/tools/automation.ts`
- `src/index.ts`
- `tests/tools/automation.test.ts`

**Estimated scope:** Small (2-3 files)

---

## Task 8: Implement subusers, account tools, CLI bin, and agent configuration README

**Description:** Create `src/tools/account.ts` (`get_account`, `list_subusers`, `create_subuser`, `delete_subuser`), ensure `dist/index.js` has `#!/usr/bin/env node` shebang and executable permissions, and write `README.md` with copy-pasteable `mcpServers` JSON snippets for Antigravity, Claude Code, Codex, and Cursor.

**Acceptance criteria:**
- [x] `get_account`, `list_subusers`, `create_subuser`, and `delete_subuser` implemented and tested
- [x] `README.md` documents `HOSTMYBOT_API_KEY`, `HOSTMYBOT_URL`, and exact JSON/CLI setup for Antigravity, Claude Code, and Codex
- [x] `npm run build` produces executable `dist/index.js`

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: `node dist/index.js --help` or `stdio` initialize handshake succeeds

**Dependencies:** Tasks 3, 5, 6, 7

**Files likely touched:**
- `src/tools/account.ts`
- `src/index.ts`
- `README.md`
- `tests/tools/account.test.ts`

**Estimated scope:** Medium (3-4 files)

---

## Checkpoint: Complete
- [x] Full test suite passes (`npm test`)
- [x] Clean build (`npm run build`)
- [x] Ready to wire into Antigravity / Claude Code / Codex

---

## Task 9: Add live WebSocket console credentials and log reader

**Description:** Add `get_websocket_credentials` (`GET /api/client/servers/{id}/websocket`) and `get_console_logs` (connects briefly via Node WebSocket with `Origin` header set to `baseUrl`, authenticates with JWT token, requests `send logs`, strips ANSI codes by default, and returns the latest lines) in `src/tools/servers.ts` and `src/client.ts`.

**Acceptance criteria:**
- [x] `get_websocket_credentials` returns `{ socket, token }`
- [x] `get_console_logs` supports `max_lines` (default `100`), `timeout_ms` (default `2500`), and `strip_ansi` (default `true`)
- [x] WebSocket connection is always closed cleanly in `finally`, even on timeout or auth failure

**Verification:**
- [x] Tests pass: `npm test -- servers`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 3

**Files likely touched:**
- `src/client.ts`
- `src/tools/servers.ts`
- `tests/tools/servers.test.ts`

**Estimated scope:** Medium (3 files)

---

## Task 10: Add system permissions and account/server activity audit logs

**Description:** Add `list_permissions` (`GET /api/client/permissions` with optional `category` filter for compact output), `get_account_activity` (`GET /api/client/account/activity`), and `get_server_activity` (`GET /api/client/servers/{id}/activity`) with compact event formatting.

**Acceptance criteria:**
- [x] `list_permissions` optionally filters by category (e.g. `file`, `control`, `backup`) to keep responses small
- [x] Activity tools support `page` and `per_page` and return `{ events, pagination }`

**Verification:**
- [x] Tests pass: `npm test -- account servers`
- [x] Build succeeds: `npm run build`

**Dependencies:** Tasks 3, 8

**Files likely touched:**
- `src/tools/account.ts`
- `src/tools/servers.ts`
- `tests/tools/account.test.ts`
- `tests/tools/servers.test.ts`

**Estimated scope:** Small (3-4 files)

---

## Task 11: Add server database management module

**Description:** Create `src/tools/databases.ts` and register it in `src/index.ts` for `list_databases`, `create_database`, `rotate_database_password`, and `delete_database`.

**Acceptance criteria:**
- [x] `list_databases` supports optional `include_password` (default `false` for security/token hygiene)
- [x] `create_database` sends `{ database, remote }` to `POST /api/client/servers/{id}/databases`
- [x] `delete_database` has `destructiveHint: true`

**Verification:**
- [x] Tests pass: `npm test -- databases`
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/tools/databases.ts`
- `src/index.ts`
- `tests/tools/databases.test.ts`

**Estimated scope:** Small (3 files)

---

## Checkpoint: After Tasks 9-11
- [x] All tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)

---

## Task 12: Add remote file pull and full network allocation CRUD

**Description:** Add `pull_remote_file` (`POST /api/client/servers/{id}/files/pull`) to `src/tools/files.ts`, and add `create_allocation`, `update_allocation_notes`, `set_primary_allocation`, and `delete_allocation` to `src/tools/settings.ts`.

**Acceptance criteria:**
- [x] `pull_remote_file` supports `url`, optional `directory`, `filename`, `use_header`, and `foreground`
- [x] Network allocation mutations hit the exact Pterodactyl endpoints and annotate `delete_allocation` as destructive

**Verification:**
- [x] Tests pass: `npm test -- files settings`
- [x] Build succeeds: `npm run build`

**Dependencies:** Tasks 4, 6

**Files likely touched:**
- `src/tools/files.ts`
- `src/tools/settings.ts`
- `tests/tools/files.test.ts`
- `tests/tools/settings.test.ts`

**Estimated scope:** Small (4 files)

---

## Task 13: Add update/get/lock tools for schedules, backups, and subusers

**Description:** Add `get_schedule`, `update_schedule`, `update_schedule_task`, `delete_schedule_task`, `get_backup`, and `toggle_backup_lock` to `src/tools/automation.ts`, plus `get_subuser` and `update_subuser` to `src/tools/account.ts`.

**Acceptance criteria:**
- [x] All 8 tools validate parameters with `zod` and return compact normalized responses
- [x] `delete_schedule_task` has `destructiveHint: true`

**Verification:**
- [x] Tests pass: `npm test -- automation account`
- [x] Build succeeds: `npm run build`

**Dependencies:** Tasks 7, 8

**Files likely touched:**
- `src/tools/automation.ts`
- `src/tools/account.ts`
- `tests/tools/automation.test.ts`
- `tests/tools/account.test.ts`

**Estimated scope:** Small (4 files)

---

## Task 14: Add account API keys & SSH keys tools and update README

**Description:** Add `list_api_keys`, `create_api_key`, `delete_api_key`, `list_ssh_keys`, `add_ssh_key`, and `remove_ssh_key` to `src/tools/account.ts`, update `README.md` with the complete 65-tool catalog, and verify build + tests + live read-only smoke test.

**Acceptance criteria:**
- [x] `delete_api_key` and `remove_ssh_key` have `destructiveHint: true`
- [x] `README.md` documents all 65 tools accurately
- [x] All unit tests, `npm run build`, and live read-only smoke check pass

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: live read-only smoke test against panel API (`list_permissions`, `get_console_logs`, `get_account_activity`, `list_api_keys`)

**Dependencies:** Tasks 9-13

**Files likely touched:**
- `src/tools/account.ts`
- `README.md`
- `tests/tools/account.test.ts`

**Estimated scope:** Medium (3 files)

---

## Checkpoint: Full API Coverage
- [x] Full test suite passes (`npm test`)
- [x] Clean build (`npm run build`)
- [x] 100% HostMyBot Client API coverage verified
