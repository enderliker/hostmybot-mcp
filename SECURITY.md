# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `hostmybot-mcp`, please **do not** open a public issue with exploit details. Instead, contact the repository maintainer privately via GitHub Security Advisories or private direct message.

## Credential Hygiene

- **Never hardcode** `HOSTMYBOT_API_KEY` (`ptlc_...`) in source files, tests, or committed MCP configuration files (like `.mcp.json`).
- Pass credentials exclusively via environment variables (`HOSTMYBOT_API_KEY`) in user-local agent configs (`~/.gemini/antigravity/mcp_config.json`, `~/.codex/config.toml`) or CLI flags at runtime.
- Rotate any client API key immediately from `https://client.hostmybot.net/account/api` if it is ever exposed in logs, screenshots, or chat transcripts.
- Destructive MCP tools (`reinstall_server`, `delete_files`, `delete_backup`, `delete_database`, `delete_api_key`, `remove_ssh_key`, `send_power_signal`) are annotated with `destructiveHint: true`, and `reinstall_server` enforces an explicit `confirm: true` parameter.
