# Jm3a Hunt — Build Plan (Phases 1–4)

Spec: `docs/SPEC.md`. Four worker tasks (user cap: at most 4 subagents). Each task leaves the app runnable. Status is updated by the orchestrator after review.

| # | Task | Tier | After | Status |
|---|---|---|---|---|
| 1 | Scaffold + shared game engine | careful | — | done |
| 2 | Server, database, realtime engine | careful | 1 | done |
| 3 | App screens and design system | careful | 1 | done |
| 4 | Map, live match, zone editor, PWA | careful | 2, 3 | done |

## 1. Scaffold + shared game engine

Create the project in the existing root (it already holds `docs/`, `CLAUDE.md`, `filemap.md`, the prompt txt; keep them). Next.js latest stable (App Router, `src/`, TS strict), Tailwind v4, shadcn/ui init, lucide-react, motion, zod, @turf/*, vitest, tsx, eslint. Fonts IBM Plex Sans + Mono via `next/font`. Scripts: `dev` (tsx watch server/index.ts), `build`, `start`, `test`, `test:watch`, `typecheck`, `lint`, `db:generate`, `db:migrate`. Minimal `server/index.ts` that serves Next, `GET /api/health`, and a `/ws` endpoint that accepts upgrades (stub) so tasks 2 and 3 can run in parallel. `src/i18n/en.ts` + `t()` + `dir`. Then the whole pure domain in `src/shared/` per SPEC §7–9: types, zod schemas for settings / zones / WS messages / REST bodies, defaults, built-in presets, geometry helpers, zone validation + overlap rules, `zoneStateAt`, boundary classifier + penalty pipeline reducer, approximation, `buildView` visibility, state machine, capture/jail/victory rules, random role assignment + reveal script generator (SPEC §8). Thorough unit tests. **Verify:** `npm run typecheck`, `npm test`, `npm run dev` serves the default page and `/api/health`.

## 2. Server, database, realtime engine

Drizzle schema + generated migrations + `db:migrate` (SPEC §4); auth, sessions, guards (§5); all REST routes (§6); WS gateway + protocol (§7); `MatchRuntime`, registry, 1 s tick, pause shifting, pings, boundary pipeline, captures/jail/rescue/victory, persistence + restart recovery, events with seq + audience filtering, idempotent opIds, rate limits, origin checks, HMAC tag tokens (§8); dev sim bots (§9). Uses only `src/shared` for rules. Integration tests with an in-process server and real WS clients for prompt scenarios 1, 2, 3, 4, 5, 7, 8, including "network capture shows no forbidden coordinates" checks. **Verify:** `npm test`, `npm run typecheck`, manual curl of key routes.

## 3. App screens and design system

Tokens (SPEC §11) in Tailwind/CSS, light + dark, shadcn components themed. `src/lib/api.ts` typed client, `src/lib/ws.ts` reconnecting client with backoff + lastSeq + time sync, `useMatch` hook. Screens: landing, guest onboarding (name + avatar), sign in / save account, dashboard, join (code + invite link with password), group page (members + roles, invite link + QR + code, presets, history, settings), match setup (preset picker → quick start, host settings with progressive disclosure, validation, dependency handling, readable summary, reset/save/duplicate preset), lobby (players, presence, ready, roles assign, consent screen with plain-language sharing rules + GPS permission check + browser limitation notice), results. Map areas are clearly marked slots that task 4 fills. **Verify:** typecheck, build, browser at 375 px + desktop, no console errors, break-ui on lists.

## 4. Map, live match, zone editor, PWA

MapLibre map component (OpenFreeMap street, MapTiler satellite + hybrid gated on key), zone layers with patterns + icons, own location + accuracy circle, live/ping/approx markers, follow/center/zoom/compass/layer toggles. GPS client (SPEC §10) with freshness + wake lock. Target-lock role reveal + personal role card at match start (SPEC §11). Live match screen with bottom tabs (Map | Players | Objectives | Events | Rules), timer, phase, role, connection badge, boundary warnings, tag flow, tag prompt, QR show/scan + 6-digit code, jail/rescue, pause/emergency/withdraw. Zone editor (draw circle/polygon/rectangle, drag/resize/vertex edit, exact radius, name/color/opacity, duplicate/delete/undo, validation messages, zone-layout presets) and dynamic phase editor with a timeline scrubber preview. Dev sim panel (tap to move, add bots) in sim matches only. PWA manifest, icons, service worker, offline page. Playwright smoke test. README + `.env.example` + honest feature checklist. **Verify:** typecheck, build, tests, browser walkthrough of a sim match end to end at 375 px and desktop.
