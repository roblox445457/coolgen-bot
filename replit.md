# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### Discord Bot (`artifacts/discord-bot`)
- Discord.js v14 bot with `j!` prefix
- Commands: `j!generate`, `j!help`, `j!help generate`
- Generates random Roblox account credentials (username, password, email, DOB, gender, country, PIN, recovery phrase)
- Requires `DISCORD_BOT_TOKEN` secret
- Workflow: "Discord Bot" — `pnpm --filter @workspace/discord-bot run dev`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/discord-bot run dev` — run Discord bot locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
