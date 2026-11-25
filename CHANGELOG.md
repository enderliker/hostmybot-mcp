# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-25

### Fixed
- Handle 0-byte and `204` responses safely in `read_file_contents` and stream responses up to `maxBytes` to avoid unbounded buffering.
- Fix quadratic backtracking (ReDoS) and over-greedy OSC matching in `stripAnsiCodes`.
- Pass `?include=egg` and `?include=egg,variables` in `list_servers` and `get_server`.
- Preserve meaningful empty strings (`""`) and `{}` values in `compactValue`.
- Add default `AbortSignal.timeout` to HTTP calls and uploads, `InvalidJsonResponse` errors on non-JSON `200` replies, Wings `{ error }` error parsing, and bounded WebSocket log buffering with `"daemon error"` handling.
- Enforce `confirm: true` when `restore_backup` uses `truncate: true`, preserve omitted flags in `update_schedule` / `update_schedule_task`, validate `chmod_files` octal modes, `remote_filename` traversal, and `http:`/`https:` URLs in `pull_remote_file`.
- Reject query/fragment/userinfo in `HOSTMYBOT_URL` and flag-like values in CLI parsing.
- Include `tests/` in `npm run typecheck` and align `engines.node` to `>=20.0.0`.

## [1.0.0] - 2026-11-25

### Added
- Initial `stdio` MCP server (`hostmybot-mcp`) built with `@modelcontextprotocol/sdk` and `zod`.
- Configuration via `HOSTMYBOT_API_KEY` / `HOSTMYBOT_URL` environment variables or `--api-key` / `--url` CLI flags.
- 65 MCP tools covering the HostMyBot / Pterodactyl Client API (`/api/client`):
  - **Servers, Power, Console & Activity:** `list_servers`, `get_server`, `get_server_resources`, `send_power_signal`, `send_console_command`, `get_websocket_credentials`, `get_console_logs` (live Wings WebSocket with ANSI stripping), `get_server_activity`.
  - **Filesystem:** `list_files`, `read_file_contents`, `write_file`, `upload_file` (two-step Wings `multipart/form-data`), `pull_remote_file`, `get_download_url`, `create_folder`, `rename_files`, `copy_file`, `delete_files`, `compress_files`, `decompress_file`, `chmod_files`.
  - **Databases:** `list_databases`, `create_database`, `rotate_database_password`, `delete_database`.
  - **Startup, Settings & Network Allocations:** `get_startup_variables`, `update_startup_variable`, `rename_server`, `set_docker_image`, `reinstall_server`, `list_allocations`, `create_allocation`, `update_allocation_notes`, `set_primary_allocation`, `delete_allocation`.
  - **Backups & Schedules:** full backup lifecycle (`list`, `get`, `create`, `get_backup_download_url`, `restore`, `toggle_backup_lock`, `delete`) and schedule/task CRUD + execution.
  - **Account, Permissions, Subusers, API Keys & SSH Keys:** account info, activity, system permission discovery, subuser CRUD, API key management, and SSH key management.
- Token-optimized JSON responses stripping verbose Pterodactyl boilerplate and formatting byte sizes.
- Agent configuration docs for Antigravity, Claude Code, and OpenAI Codex CLI.
