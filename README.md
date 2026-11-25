# hostmybot-mcp

Model Context Protocol (MCP) server for the **HostMyBot / Pterodactyl Client API** (`/api/client`). Designed for AI coding agents (**Antigravity**, **Claude Code**, **Codex**, **Cursor**, and any `stdio` MCP client) with token-optimized responses and full coverage of server management, file uploads/downloads, backups, cron schedules, startup variables, and subusers.

## Features

- **Token-optimized responses:** Strips noisy Pterodactyl wrapper objects (`object: "list"`, empty/null fields, verbose egg invocation scripts) and formats byte sizes into human-readable units.
- **Safety guards & MCP annotations:** Read-only and destructive tools include standard MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`). `reinstall_server` requires `confirm: true`.
- **Two-step binary/text file upload:** `upload_file` reads a local file from disk, requests a signed Wings upload URL, and uploads via `multipart/form-data`.
- **Agent-agnostic configuration:** Pass credentials via `env` (`HOSTMYBOT_API_KEY`, `HOSTMYBOT_URL`) or CLI flags (`--api-key`, `--url`).

## Setup

### 1. Build from source

```bash
git clone https://github.com/enderliker/hostmybot-mcp.git
cd hostmybot-mcp
npm install
npm run build
```

Requires **Node.js >= 20** and a Pterodactyl Client API key (`ptlc_...`) generated from `https://client.hostmybot.net/account/api`.

### 2. Configure in your MCP Agent

#### Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "hostmybot": {
      "command": "node",
      "args": ["/path/to/hostmybot-mcp/dist/index.js"],
      "env": {
        "HOSTMYBOT_API_KEY": "ptlc_YOUR_CLIENT_API_KEY",
        "HOSTMYBOT_URL": "https://client.hostmybot.net"
      }
    }
  }
}
```

#### Claude Code

Using the CLI:

```bash
claude mcp add hostmybot \
  -e HOSTMYBOT_API_KEY=ptlc_YOUR_CLIENT_API_KEY \
  -e HOSTMYBOT_URL=https://client.hostmybot.net \
  -- node /path/to/hostmybot-mcp/dist/index.js
```

Or in `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "hostmybot": {
      "command": "node",
      "args": ["/path/to/hostmybot-mcp/dist/index.js"],
      "env": {
        "HOSTMYBOT_API_KEY": "ptlc_YOUR_CLIENT_API_KEY",
        "HOSTMYBOT_URL": "https://client.hostmybot.net"
      }
    }
  }
}
```

#### OpenAI Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.hostmybot]
command = "node"
args = ["/path/to/hostmybot-mcp/dist/index.js"]

[mcp_servers.hostmybot.env]
HOSTMYBOT_API_KEY = "ptlc_YOUR_CLIENT_API_KEY"
HOSTMYBOT_URL = "https://client.hostmybot.net"
```

#### CLI Flags (Alternative to Env Vars)

```bash
node /path/to/hostmybot-mcp/dist/index.js \
  --api-key ptlc_YOUR_CLIENT_API_KEY \
  --url https://client.hostmybot.net
```

## Available Tools (65)

### Servers, Power, Live Console & Activity
- `list_servers` — List accessible servers with compact summary (ID, name, node, limits, primary address, SFTP).
- `get_server` — Get detailed server configuration (optionally include startup variables).
- `get_server_resources` — Live state, CPU %, memory, disk, network RX/TX, and uptime.
- `send_power_signal` — Send `start`, `stop`, `restart`, or `kill`.
- `send_console_command` — Execute a console command on a running server.
- `get_websocket_credentials` — Get the Wings WebSocket URL and JWT token for live streaming.
- `get_console_logs` — Connect briefly to the console WebSocket, read recent lines (ANSI-stripped by default), and disconnect.
- `get_server_activity` — View recent server audit activity logs.

### Filesystem
- `list_files` — List directory entries sorted folders-first with human-readable sizes.
- `read_file_contents` — Read text file contents (auto-capped at `max_chars`, default `50000`).
- `write_file` — Create or overwrite a text file directly.
- `upload_file` — Upload a local file (binary or text) via Wings signed upload URL (`multipart/form-data`).
- `pull_remote_file` — Download a file from a remote HTTP/HTTPS URL directly into a server directory.
- `get_download_url` — Generate a signed download URL for a remote file.
- `create_folder` — Create a directory.
- `rename_files` — Rename or move files/folders.
- `copy_file` — Duplicate a file.
- `delete_files` — Delete files or directories.
- `compress_files` — Create a `.tar.gz` archive.
- `decompress_file` — Extract an archive.
- `chmod_files` — Update Unix file permissions.

### Databases
- `list_databases` — List server databases (passwords hidden unless `include_password=true`).
- `create_database` — Provision a new database.
- `rotate_database_password` — Rotate a database password and return the new credential.
- `delete_database` — Permanently delete a database.

### Startup, Settings & Network Allocations
- `get_startup_variables` — View startup command, Docker images, and environment variables.
- `update_startup_variable` — Update an editable startup variable (e.g. `MAIN_FILE`).
- `rename_server` — Update server name and description.
- `set_docker_image` — Switch Docker runtime image.
- `reinstall_server` — Trigger server reinstall (requires `confirm: true`).
- `list_allocations` — List IP/port allocations.
- `create_allocation` — Auto-assign a new allocation within server limits.
- `update_allocation_notes` — Update allocation notes.
- `set_primary_allocation` — Set an allocation as primary/default.
- `delete_allocation` — Remove a non-primary allocation.

### Backups & Schedules (Cron)
- `list_backups` — List existing backups and sizes.
- `get_backup` — Get metadata for a single backup.
- `create_backup` — Create a new backup.
- `get_backup_download_url` — Generate a signed backup download URL.
- `restore_backup` — Restore a backup (optional `truncate: true`).
- `toggle_backup_lock` — Lock or unlock a backup against deletion.
- `delete_backup` — Delete a backup.
- `list_schedules` — List cron schedules and their tasks.
- `get_schedule` — Get details and tasks for a single schedule.
- `create_schedule` — Create a new cron schedule.
- `update_schedule` — Update a cron schedule.
- `delete_schedule` — Remove a schedule.
- `execute_schedule` — Trigger a schedule immediately.
- `create_schedule_task` — Add a `command`, `power`, or `backup` task to a schedule.
- `update_schedule_task` — Update an existing schedule task.
- `delete_schedule_task` — Delete a task from a schedule.

### Account, Permissions, Subusers, API Keys & SSH Keys
- `get_account` — Get authenticated account info.
- `get_account_activity` — View recent account audit activity logs.
- `list_permissions` — List valid Pterodactyl permission nodes (optionally filtered by category).
- `list_subusers` — List subusers and their permissions.
- `get_subuser` — Get a single subuser's details and permissions.
- `create_subuser` — Invite a subuser with specific permissions.
- `update_subuser` — Replace a subuser's permission nodes.
- `delete_subuser` — Remove a subuser.
- `list_api_keys` — List client API keys on the account.
- `create_api_key` — Create a new client API key.
- `delete_api_key` — Revoke and delete a client API key.
- `list_ssh_keys` — List registered SFTP SSH keys.
- `add_ssh_key` — Add an SSH public key.
- `remove_ssh_key` — Remove an SSH public key by fingerprint.

## Development & Testing

```bash
npm run typecheck  # Strict TypeScript type checking
npm test           # Run Vitest unit & MCP protocol tests
npm run build      # Compile TypeScript to dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), and [ADR-0001](docs/decisions/0001-architecture.md) for development guidelines and architectural context.

## License

[MIT](LICENSE) © 2026 enderliker
