# Contributing to hostmybot-mcp

Thank you for contributing! All code, tests, documentation, and commit messages in this repository are written in **English**.

## Development Setup

```bash
git clone <repo-url>
cd hostmybot-mcp
npm install
```

## Quality Gates

Before opening a pull request, make sure every check passes locally:

```bash
npm run typecheck   # TypeScript strict type-check (tsc --noEmit)
npm test            # Vitest unit & MCP protocol test suite
npm run build       # Compile dist/index.js and set executable permissions
```

## Guidelines

- **Follow Pterodactyl Client API (`/api/client`) conventions:** Keep each tool focused, validate inputs with `zod`, and set accurate MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`).
- **Keep responses token-optimized:** Strip redundant Pterodactyl wrapper boilerplate (`object`, empty/null fields) via `src/format.ts` helpers.
- **Never commit real credentials or live server IDs:** Tests must use mocked `fetch` / `wsFactory` and dummy identifiers (e.g. `00000000`, `192.0.2.x`).
- **Commit format:** Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
