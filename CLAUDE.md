# Jm3a Hunt

Stack: Next.js (App Router, `src/`) + custom Node server (`server/index.ts`: Next + Hono `/api` + `ws` `/ws`) + SQLite via libSQL/Drizzle. TypeScript strict, Tailwind v4, shadcn/ui, MapLibre, turf, zod, Vitest.

## Commands
- `npm run dev` — one process: Next + API + WebSocket on http://localhost:3000
- `npm test` — Vitest (unit + integration); `npm run typecheck`; `npm run lint`; `npm run build`
- `npm run db:generate` after editing `server/db/schema.ts`; `npm run db:migrate` to apply

## Rules that are easy to get wrong
- Game rules live only in `src/shared/` (pure, no IO). Server and client import them; never fork logic.
- Coordinates reach a client only through `buildView` in `src/shared/visibility/`. Never send, log or persist other players' raw locations. Host/admin get no extra visibility.
- Locations are in server memory only; never write them to the DB, events or logs.
- Every REST body and WS message is zod-validated; authorization comes from DB membership, never from client claims.
- All UI strings go in `src/i18n/en.ts`; use logical CSS (`ms/me/ps/pe/start/end`), never left/right.
- Times are server epoch ms; clients use the server offset from `src/lib/time-sync.ts`.
- Simulated GPS/bots only when `ALLOW_SIM_GPS=true` and not production.

Docs: `docs/SPEC.md` (contracts), `docs/PLAN.md` (tasks), `filemap.md` (where things live — update it when adding/moving files).
