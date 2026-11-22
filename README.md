# Jm3a Hunt

Real-world hide and seek for groups of 2–15 friends, played on phones with GPS. Make a group, invite friends with a link, QR code or 8-character code, draw the play area on a map, and play: roles are drawn at the start, hiders run, seekers hunt, and every capture is confirmed by both players (or by scanning the hider's code). It is a Progressive Web App: open it in the browser, optionally add it to the home screen.

Location is shared only during a match you agreed to, only as that match's rules say, filtered on the server, and never stored.

## Quick start

Requirements: Node 24 and npm. No Docker, no external services.

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm run dev` starts one process: Next.js, the REST API (`/api`) and the WebSocket server (`/ws`). The SQLite database is created and migrated in `data/jm3a.db` on first start.

To try a whole match alone, put `ALLOW_SIM_GPS=true` in `.env`, create a match, then **Edit rules → Test match (simulated GPS)**. The lobby then offers **Add bot**; in the match you move yourself by tapping the map.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server (Next + API + WebSocket) with hot reload on http://localhost:3000 |
| `npm run build` | Production build of the web app |
| `npm start` | Production server (`NODE_ENV=production`) |
| `npm test` | Unit and integration tests (Vitest; in-process server with real WebSocket clients) |
| `npm run test:e2e` | Playwright smoke tests (own server on port 3100, temp database, simulated GPS). Stop `npm run dev` first: Next allows one dev server per folder. First time: `npx playwright install chromium` |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run db:generate` / `npm run db:migrate` | Drizzle migrations (after editing `server/db/schema.ts`) / apply them |

## Environment variables

See `.env.example`. All are optional in development.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Render sets it |
| `APP_ORIGIN` | `http://localhost:$PORT` | Your public https URL in production (Origin check for API and WebSocket) |
| `DATABASE_URL` | `file:./data/jm3a.db` | Local SQLite file, or `libsql://…` for Turso |
| `DATABASE_AUTH_TOKEN` | – | Turso token |
| `SESSION_SECRET`, `TAG_TOKEN_SECRET` | generated in dev | **Required in production** (≥ 32 characters). In development they are generated once and kept in `data/dev-secrets.json` so restarts do not invalidate anything |
| `NEXT_PUBLIC_MAPTILER_KEY` | – | Enables satellite and hybrid maps (MapTiler free tier). Read at build time. Without it those buttons are disabled with an explanation; no other imagery is substituted |
| `ALLOW_SIM_GPS` | `false` | Development only: simulated GPS and bots. Always off in production |

## Testing on a real phone

Browsers only give GPS to secure (https) pages, so `http://192.168.x.x:3000` will not work for location. Use a free Cloudflare quick tunnel:

```bash
npm run dev
cloudflared tunnel --url http://localhost:3000
```

Open the printed `https://….trycloudflare.com` URL on the phone. Set `APP_ORIGIN` to that URL in `.env` and restart `npm run dev` (the Origin check otherwise rejects changes). The tunnel URL changes every time.

## Free deployment: Render + Turso

1. Create a free [Turso](https://turso.tech) database; note its `libsql://` URL and an auth token.
2. On [Render](https://render.com), create a **Web Service** from this repo (or use the included `render.yaml` Blueprint):
   - Build command: `npm ci --include=dev && npm run build`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Environment: `NODE_VERSION=24`, `APP_ORIGIN=https://<your-service>.onrender.com`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `SESSION_SECRET`, `TAG_TOKEN_SECRET`, optionally `NEXT_PUBLIC_MAPTILER_KEY`.
3. Migrations run automatically on boot.

Free-tier limits: the service sleeps after about 15 idle minutes (the first request then takes up to a minute), and its disk is wiped on every deploy, which is why the database lives on Turso. Live matches survive a restart (snapshot in the database, minus locations), but players must reopen the app.

### Self-hosting

Any machine with Node 24: `npm ci --include=dev && npm run build`, then `NODE_ENV=production … npm start` behind an https reverse proxy (Caddy, nginx) or a named Cloudflare Tunnel. A local `file:` database works fine on a persistent disk. The proxy must pass WebSocket upgrades for `/ws`.

## Architecture

One Node process (`server/index.ts`) hosts Next.js (App Router, React 19, Tailwind, shadcn/ui), a Hono REST API under `/api` and a `ws` WebSocket gateway at `/ws`. The match engine (`server/engine`) keeps each live match in memory, runs authoritative timers on a 1-second tick and sends every player a view built for them. All game rules live in `src/shared` as pure TypeScript used by both server and client: zone timelines, boundary checks, visibility and capture rules are computed once, identically. Data is SQLite through libSQL + Drizzle; live locations are memory-only. Maps use MapLibre GL JS with OpenFreeMap street tiles and optional MapTiler satellite/hybrid.

Why not Supabase or Vercel: Supabase needs an external project even to run tests, and Postgres/Docker were not available on the development machine; Vercel cannot hold WebSocket connections, and authoritative game timers plus per-player filtered broadcasts want one long-running process. A single Node process is the easiest thing to run, test and host for free.

## GPS and browser limitations (honest version)

- **Foreground only.** Phones stop giving web apps location when the screen locks or the app goes to the background. There is no background tracking and the app does not fake it. When you come back, the app says tracking was paused and sends a fresh position at once. "Keep screen awake" (Screen Wake Lock) helps; it is not supported everywhere.
- **Accuracy varies.** Expect 5–20 m outdoors, much worse indoors or between tall buildings. Boundary checks therefore use accuracy-aware rules: a reading only counts as outside when it is outside by more than its own accuracy plus a tolerance, for a sustained time, and uncertain readings never cause a penalty.
- **GPS is never proof of a capture.** Tags are confirmed by the hider, or by scanning the hider's rotating QR / 6-digit code. A "far apart" hint is only advisory.
- **iPhone:** Safari asks for location per site; Location Services and Safari's location permission must both be on. QR scanning on iPhone uses a JavaScript fallback (no native BarcodeDetector).
- **https is required** for GPS, camera and the service worker.

## Privacy model

- Groups are invite-only; joining shares your name and avatar with the group.
- Before each match every player sees, in plain words, exactly what they will share, with whom, and when, and must agree. Any rule change that affects sharing asks again.
- The server filters every view per player. Hosts and admins see nothing extra.
- Approximate pings are snapped to a randomly offset grid on the server, so repeated pings of a still player reveal nothing new.
- Locations exist only in server memory during a match. They are never written to the database, events or logs, and are deleted on match end, withdrawal, emergency stop or restart.
- Any player can press **Stop** (emergency) to pause the match for everyone and stop their own sharing immediately, or leave the match.

## Feature checklist

**Fully implemented (covered by unit/integration/e2e tests or checked in a browser)**
- Guest accounts with optional username + password; groups with roles (owner/admin/member), invite link, QR and join code, optional password
- Match setup with presets (Classic, Manhunt + Jail, Shrinking Hunt, Casual), progressive-disclosure settings, validation, plain-language summary, saved game presets
- Lobby with consent, GPS check, ready, random or manual roles, presence, start checks
- Server-authoritative state machine, timers, pause/resume, emergency stop, reconnect with snapshot, restart recovery
- Target-lock role reveal synced to server time, then a personal role card (reduced-motion variant)
- Live map: street / satellite / hybrid, zone overlays with distinct line styles, hatching and icons, own position + accuracy circle, teammates, exact and approximate pings with age, "no signal" list, follow / center / zoom / compass / layer toggles
- Shrinking and moving play area computed on every phone from the shared timeline; zone warnings; accuracy-aware boundary warnings with grace countdown
- Capture by tag + confirm (with dispute and host resolution), by QR scan, or by 6-digit code; convert / eliminate / jail / freeze outcomes; jail release and rescue (confirm or QR); win conditions and points mode; results with highlights
- Zone editor: circle / rectangle / polygon, select, drag, resize, vertex insert/remove, exact radius, name, 10 types, colour, fill, visibility per role, duplicate, delete, undo/redo, "circle around me", live validation, overlap help, shrinking/moving stages placed on the map, timeline scrubber, preview as player, zone-layout presets
- Dev simulation: TEST banner, tap-to-move, bots
- PWA: manifest, generated icons (incl. maskable), service worker (production only) with offline page

**Partial**
- Zone editing is touch- and mouse-driven; keyboard users can edit everything through the form fields (radius, stages) but cannot drag shapes on the map.
- Notifications are in-app toasts and vibration only (no Web Push).
- Zone layouts can be saved and loaded from the editor; renaming/deleting them happens in the group's preset list.

**Planned (not built)**
- Phases 5–7 of the product plan: Capture the Flag, Zone Control, shrinking-zone survival mode, infection, custom WHEN/IF/THEN rule builder, referee role
- Arabic (RTL is prepared: logical CSS, `dir`, string catalogue), Web Push, scheduled matches, leaderboards, polygon shrink phases

**Unverified**
- Real-device testing on iPhone Safari and Android Chrome (GPS behaviour, wake lock, camera QR scanning, installing to the home screen). Development used desktop Chrome with device emulation and simulated GPS.
- Behaviour on Render's free tier under real load.
- Browser walkthroughs covered tag + confirm, the 6-digit code capture, zone shrink, boundary warning, emergency stop and results. The jail / rescue / freeze screens and camera QR scanning were not exercised in a browser (their server rules are integration-tested).
