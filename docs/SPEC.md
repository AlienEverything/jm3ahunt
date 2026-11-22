# Jm3a Hunt — Technical Spec (Phases 1–4)

Product vision and full requirements: `../Jm3a Hunt PROMPT.txt` (the user's master prompt). This file records the decisions and contracts every worker builds against. Where this file and the prompt disagree, this file wins (it reflects decisions taken with the user).

## 1. Goals and non-goals

**Goals (this build):** prompt phases 1–4.
- Guest-first accounts (optional username + password), persistent groups, invite links + join codes, roles owner/admin/member.
- Dashboard, group page, match lobby (ready, roles, consent, GPS status, presence).
- Live map: own location + accuracy circle, street / satellite / hybrid, zone overlays, freshness states.
- Hide & Seek complete core: role assignment, countdown, hiding phase, configurable pings (exact / approximate, server-side), mutual-confirmation capture and QR capture, outcomes (convert, eliminate, jail, freeze), jail + rescue basics, win conditions, results.
- Authoritative state machine, server timers, reconnection with snapshot restore.
- Advanced zone editor: circles, polygons, rectangles, multiple zones, 10 zone types, drag / resize / vertex edit, exact radius, name / color / opacity, duplicate / delete / undo, zone-layout presets, overlap validation.
- Dynamic zones: multi-phase shrinking and moving waypoint circles inside the approved area.
- Accuracy-aware boundary checks (tolerance, debounce, grace, never penalise on one reading).
- Host settings with progressive disclosure, validation, dependency handling, readable summary, game presets.
- PWA (manifest, icons, service worker). Dev-only simulated GPS + bot players.

**Non-goals now (planned later, engine must stay extensible):** Capture the Flag, Zone Control, shrinking-zone survival mode, infection, custom WHEN/IF/THEN rule builder, referee role, Web Push, Arabic strings, scheduled matches, leaderboards. Polygon *shrink phases* are planned; dynamic phases are circles only.

**Never:** virtual currencies, loot, RPG progression, secret host tracking, fake background tracking, storing location history.

## 2. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 24, npm, single process |
| Frontend | Next.js (latest stable, App Router, `src/` dir), React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui, lucide-react, `motion` (restrained) |
| Server | Custom Node HTTP server (`server/index.ts`) embedding Next's request handler; REST via Hono (`@hono/node-server`) under `/api`; WebSockets via `ws` at `/ws` |
| DB | SQLite through `@libsql/client` + Drizzle ORM + drizzle-kit migrations. Local: `file:./data/jm3a.db`. Hosted free option: Turso (same driver, URL + token) |
| Geometry | `@turf/*` (v7), shared by client and server |
| Validation | `zod` on every REST body and WS message |
| Maps | MapLibre GL JS. Street: OpenFreeMap styles (free, no key). Satellite + Hybrid: MapTiler (`NEXT_PUBLIC_MAPTILER_KEY`, free tier). No key ⇒ satellite/hybrid buttons disabled with an explanation. Never substitute unlicensed tiles. |
| Zone drawing | `terra-draw` + its MapLibre adapter if it fits the zone model; otherwise custom MapLibre handles |
| QR | generate: `qrcode`; scan: native `BarcodeDetector` with `qr-scanner` fallback |
| Tests | Vitest (unit + integration), Playwright (e2e smoke) |
| Dev runner | `tsx watch server/index.ts` (one command starts Next + API + WS) |

Why not Supabase / Vercel: no Docker or Postgres on the dev machine, Supabase needs an external project to test anything, and authoritative timers + per-viewer filtered broadcasts want a long-running process. Vercel cannot host WebSockets. One Node process is the easiest thing to run, test and deploy for free.

## 3. Directory layout

```
server/            Node process: index.ts (http + Next + Hono + ws), config.ts
  http/            Hono routes (auth, me, groups, presets, matches)
  ws/              WebSocket gateway: auth on upgrade, message dispatch, per-client send queue
  engine/          MatchRuntime, registry, tick loop, persistence/recovery, broadcast
  db/              drizzle schema.ts, client.ts, migrate.ts
  auth/            sessions, passwords, guards
  security/        rate limits, origin check, tokens (HMAC)
  sim/             dev-only bots and simulated GPS
src/shared/        PURE TypeScript domain, no IO, imported by client and server
  types.ts schemas/ defaults/ presets.ts geo/ zones/ visibility/ match/ capture/ i18n-free
src/app/           Next App Router pages
src/components/    ui/ (shadcn), layout/, map/, zones/, lobby/, match/, settings/
src/lib/           client: api.ts, ws.ts (reconnecting client), gps.ts, time-sync.ts, utils
src/i18n/          en.ts (all UI strings), index.ts (t(), dir)
drizzle/           generated SQL migrations
tests/             integration/ (server scenarios), e2e/ (Playwright)
public/            icons, sw.js, offline.html
docs/              SPEC.md, PLAN.md
```

`@/*` → `src/*` (tsconfig paths; tsx and Next both resolve it). Unit tests sit next to the code as `*.test.ts`.

## 4. Data model (SQLite, Drizzle)

IDs: `nanoid(21)` strings. Times: integer epoch ms (server clock).

- `users` id, display_name, username (unique, nullable), password_hash (nullable), avatar_color, avatar_emoji, created_at, stats_json (matches, wins, captures, times_captured, rescues)
- `sessions` id, user_id, token_hash (sha256), created_at, expires_at, last_seen_at
- `groups` id, name, icon (emoji), owner_id, join_code (unique, 8 chars Crockford base32), invite_token (unique, 22 chars base64url = 128 bits), password_hash (nullable), max_members (default 15), settings_json, created_at
- `group_members` group_id, user_id, role (`owner|admin|member`), joined_at — PK (group_id, user_id)
- `presets` id, group_id, kind (`game|zones`), name, mode, data_json, created_by, created_at, updated_at
- `matches` id, group_id, name, mode (`hide_seek` now), state, host_id, settings_json, zones_json, settings_hash, created_at, started_at, ended_at, result_json, snapshot_json (crash recovery, **never contains locations**), version
- `match_players` match_id, user_id, role, team, status, ready, consent_hash (settings_hash the player accepted, nullable), joined_at, left_at, stats_json — PK (match_id, user_id)
- `match_events` id, match_id, seq (per match, monotonic), type, actor_id, payload_json, audience (`all|role:<r>|user:<id>`), created_at — **no coordinates in payloads**
- `captures` id, match_id, seeker_id, hider_id, method (`mutual|qr|code`), status (`pending|confirmed|disputed|rejected|expired`), created_at, resolved_at, resolved_by

Live locations live **only in server memory** (`MatchRuntime.locations`), cleared on match end, withdrawal, emergency stop, and server restart. Nothing writes coordinates to the DB or logs. One group has at most one match in a non-terminal state.

## 5. Auth and authorization

- Guest: `POST /api/auth/guest {displayName}` creates user + session; cookie `jh_session` (httpOnly, SameSite=Lax, Secure in production, 180 days). Token = 32 random bytes base64url; DB stores sha256.
- Upgrade: `POST /api/auth/register {username, password}` attaches credentials to the current user (bcryptjs cost 12). `POST /api/auth/login`, `POST /api/auth/logout`.
- Every mutating REST request: JSON body, zod-validated, Origin header must match `APP_ORIGIN` (or same host). WS upgrade: same cookie + Origin check.
- Authorization is computed from DB membership + match role on every request. UI labels are never trusted. Group owner/admin manage members and create matches. Match host = creator (or group owner/admin) — admin powers only, never extra visibility.
- Rate limits (in-memory token buckets): join/code attempts 10/min per IP and user; auth 10/min per IP; GPS 1 accepted fix per 2 s per player (excess dropped silently); capture/tag/QR/code actions 6/min per player; generic REST 120/min per user.

## 6. REST API (`/api`, JSON)

```
POST   /auth/guest | /auth/register | /auth/login | /auth/logout
GET    /me                         -> user, groups summary, active matches
PATCH  /me                         {displayName?, avatarColor?, avatarEmoji?}
GET    /groups                     -> my groups
POST   /groups                     {name, icon, password?, maxMembers?}
GET    /groups/:id                 -> group, members, current match, recent matches, presets (members only)
PATCH  /groups/:id                 owner/admin
POST   /groups/:id/regenerate-codes owner/admin
PUT    /groups/:id/members/:userId {role}   owner only (admin promote/demote); DELETE to remove (owner/admin)
POST   /groups/:id/leave
GET    /invite/:token              -> public preview {groupName, icon, memberCount, needsPassword} (rate-limited)
POST   /groups/join                {codeOrToken, password?}
GET    /groups/:id/presets | POST | PATCH /presets/:id | DELETE /presets/:id | POST /presets/:id/duplicate
POST   /groups/:id/matches         {presetId? | settings?, zones?, name} -> match in `draft` (or `lobby` when quickStart:true)
GET    /groups/:id/matches         history (results only, no locations)
GET    /matches/:id                lobby/public info for members
PUT    /matches/:id/settings       host/admin, draft|lobby only; resets every player's ready + consent
PUT    /matches/:id/zones          host/admin, draft|lobby only; same reset
GET    /matches/:id/results
```

Errors: `{error: {code, message}}` with proper HTTP status.

## 7. WebSocket protocol (`/ws`)

One socket per open match screen. JSON messages, every message zod-validated, max 8 KB. Actions carry `opId` (uuid); server keeps the last 200 opIds per player and acks duplicates without re-applying (idempotency).

Client → server:
```
hello      {matchId, lastSeq?}
loc        {lat, lng, acc, ts, speed?, heading?, sim?}     only when consented and state ∈ countdown|hiding|active|paused
consent    {accept: true, settingsHash} | {accept: false}   false = withdraw sharing now
ready      {ready: boolean}                                  requires consent for current settingsHash
host       {opId, op: open|start|pause|resume|end|assignRoles|setRole|kick|resolveCapture, ...}
emergency  {opId}                     any player: pauses match for everyone, stops own tracking
withdraw   {opId}                     leave match: stops tracking, status `withdrawn`
tag        {opId, hiderId}            seeker starts mutual capture
tagReply   {opId, captureId, accept}  hider confirms or disputes
qrToken    {}                         hider asks for a fresh tag token
qrScan     {opId, token}              seeker submits scanned QR or 6-digit code
rescue     {opId, jailedId}           per rescue method
hb         {}                         heartbeat (every 15 s)
```

Server → client:
```
welcome  {serverNow, userId}
view     {v: MatchView}          full filtered snapshot for THIS viewer (throttled ≤ 1 per 1.5 s unless urgent)
event    {e: MatchEvent}         seq-ordered, audience-filtered
prompt   {kind: 'tagRequest', captureId, seekerName, expiresAt}
qr       {token, code, expiresAt}
ack      {opId, ok, error?}
error    {code, message}
hbAck    {serverNow}
```

Reconnect: client reconnects with exponential backoff (1 s → 15 s, jitter), sends `hello {lastSeq}`; server re-authenticates membership, sends `welcome` + `view` + missed events with seq > lastSeq (capped at 200). GPS resumes only if `view.me.consent` still matches `settingsHash`.

`MatchView` (built per viewer by `src/shared/visibility`):
```
matchId, groupId, name, mode, state, settingsHash, version
clock: {serverNow, countdownEndsAt?, hidingEndsAt?, activeStartedAt?, endsAt?, pausedAt?, pausedTotalMs}
settings            (full rules: all rules are public by design)
zones               (zones whose visibleTo includes the viewer's role)
me: {userId, role, team, status, isHost, consent, ready, tracking, boundary: {state, warningEndsAt?}, freezeEndsAt?, jailEndsAt?, rescuesLeft}
players: [{userId, name, avatar, role, status, presence: online|stale|offline, ready, isHost}]
locations: [{userId, kind: live|ping, precision: exact|approx, lat, lng, radiusM?, acc?, at}]   ONLY authorized entries
nextPingAt?, scores?, pendingCapture?, reveal?, result?
```

## 8. Match engine

`MatchRuntime` (server memory) per non-terminal match; DB holds settings, players, events, snapshot. Tick every 1 s. Snapshot (minus locations) is written on each transition and every 15 s; on boot, non-terminal matches are restored and deadlines continue from absolute timestamps (a match whose `endsAt` passed while down finishes on restore).

### State machine (pure, `src/shared/match/stateMachine.ts`)

```
draft → lobby → preflight → countdown → hiding → active → finished → archived
                    ↓ fail       countdown|hiding|active ⇄ paused
                  lobby          any non-terminal → finished (end / emergency cancel / expiry)
```
- `draft`: host configuring; only host/admins see it. Quick start skips to `lobby`.
- `lobby`: members join, pick consent + ready. Any settings/zones change resets ready + consent.
- `preflight` (transient, ≤ 5 s): server validates settings + zones, checks min players ready, assigns roles, locks settings. Failure → `lobby` with reasons.
- **Role assignment + reveal:** default `assignment: 'random'` — the server picks seekers with `crypto` randomness **at start**, never earlier (nobody, host included, knows roles in the lobby). `manual` lets the host set roles in the lobby. The server also generates a reveal script `reveal: {startsAt, hopMs: number[], hops: userId[], seekerIds}` (12–18 hops that ease out and land on each seeker in turn) and puts it in `MatchView`, so every phone plays the identical "Target lock" animation in sync during the first ~5 s of `countdown` (default countdown 10 s). The animation is cosmetic; roles are already final on the server.
- `countdown` → `hiding` (if hidingSec > 0) → `active` → `finished` when a victory condition resolves or time runs out (overtime if configured).
- `paused`: from countdown/hiding/active. Shifts every deadline by the paused duration on resume. Emergency stop by any player pauses for all.
- `archived`: set when the next match is created or after 24 h.
- Player leave/rejoin, host disconnect (match continues; another admin or owner can act), and expiry are handled. Illegal transitions throw and are unit-tested.

### Zone timeline (pure, `src/shared/zones/`)

- Zone shape: `{kind: 'circle', center: [lng, lat], radiusM}` or `{kind: 'polygon', ring: [lng, lat][]}` (rectangles are polygons).
- Zone types: `main, safe, restricted, jail, rescue, capture, flag, control, spawn, objective`. Each zone: `id, type, name, color, opacity, shape, enabled, visibleTo (roles), behavior`.
- `behavior` (main zone only in this build): `static` | `shrinking {startDelaySec, warningSec, phases: [{holdSec, shrinkSec, center, radiusM}]}` | `moving {startDelaySec, warningSec, waypoints: [{center, radiusM, holdSec, moveSec}]}` (moving waypoints may change radius ⇒ move + shrink together).
- The main zone's static shape is the **approved area**. The effective play area at time t = approved area ∩ current dynamic circle. Every phase circle / waypoint must lie fully inside the approved area (validated). No polygon shrink algorithm.
- `zoneStateAt(behavior, elapsedActiveMs)` is pure; clients compute the same boundary from `clock` + server time offset, so every client shows identical shrinking without per-tick broadcasts. Phase start, warning and end also emit events.
- Overlap priority (documented in UI): `restricted` > `jail` (for jailed players) > `safe` > objective-type zones > `main`. Validation errors: safe ∩ restricted, spawn/jail/rescue/objective outside the approved area or touching restricted, phase circle outside approved area, self-intersecting polygon, radius < 10 m or > 20 km, no main zone. Warnings: restricted zone fully outside play area, increasing shrink radius.

### Location, freshness, boundary

- Client classifies its own GPS: `live` (< 10 s), `delayed` (< staleAfterSec, default 45 s), `stale`, `off/denied/unavailable`. Server tracks received-at time independently and is the authority for others' presence.
- Jump filter: a fix implying > `maxSpeedMps` (default 12) is held as `suspect` until confirmed by the next fix.
- Boundary classifier per fix: signed distance d to effective boundary; `inside` if d ≤ −acc; `outside` if d > acc + toleranceM; else `uncertain`. Fixes with acc > `maxAccuracyM` (default 50) are always `uncertain`.
- Penalty pipeline: `outside` must persist for `debounceSec` (default 20 s, ≥ 2 fixes) → player warned with `warningEndsAt` (grace default 45 s) → still confidently outside at the end ⇒ configured action: `warn_only` (default) | `reveal` (one exact ping to opponents, consent covers it) | `eliminate` | `host_review`. Uncertain readings never advance the pipeline. Same pipeline for restricted zones.

### Visibility (pure, `src/shared/visibility/`) — the privacy core

- `buildView(viewerId, runtime)` returns only what the rules allow. It is the single function that produces location data for a client. No other code path sends coordinates.
- Rules: own location exact; `seekersSeeSeekers` (default on, live) / `hidersSeeHiders` (default off); opponent pings per `pings` settings (`intervalSec`, `precision`, `approxRadiusM`, `firstPingAfterSec`, `reciprocal`, `finalRevealMin`); boundary `reveal` penalty. Host/admin gets nothing extra.
- Ping = snapshot taken at ping time of each target's fresh location. Stale targets appear as "no signal" (no coordinates).
- Approximation is done on the server before sending: snap to a per-match randomly offset grid with cell size `approxRadiusM·√2`; send the cell center with radius `approxRadiusM` (true point is always inside; repeated pings of a stationary player leak nothing new). Approx circles render differently from GPS-accuracy circles.
- Zones with restricted `visibleTo` (e.g. rescue zones) are filtered here too.
- Consent: a player shares nothing until they accept the current `settingsHash`. Withdraw or emergency ⇒ their location is deleted from memory immediately and excluded from every later view. Any setting change that broadens sharing requires fresh consent (enforced by the hash).

### Capture, jail, victory (`src/shared/capture/`, engine)

- Methods (any enabled set): `mutual` (seeker `tag` → hider prompt, confirm within `confirmTimeoutSec` = 60, dispute ⇒ `disputed`, host may resolve, logged publicly), `qr` (hider shows a rotating QR, 30 s, HMAC-signed `{matchId, hiderId, exp}`), `code` (same token as a 6-digit code for no-camera use; rate-limited).
- One pending capture per hider. Duplicate or late confirmations are no-ops. Frozen, jailed, safe-zone (confidently inside), already-captured hiders cannot be captured; rejection reason is shown to the seeker.
- Optional proximity hint (`off|warn`): if both fixes are fresh and farther apart than `maxTagDistanceM + accA + accB`, the seeker gets a warning; GPS is never proof.
- Outcomes: `convert` (becomes seeker), `eliminate`, `jail` (status jailed, release after `maxJailSec`, rescue by a free hider via `confirm` (jailed player confirms) or `qr`; `maxRescues`, `cooldownSec`), `freeze` (`freezeSec`, then free).
- Victory: seekers win when no hider is free (jailed count as caught); hiders win if ≥ 1 is free at `endsAt` (+ overtime). Optional points mode (seekers: points per capture, hiders: points per minute survived) decides instead. Tie-break setting.
- Stats per player: captures, times captured, survived seconds, rescues. Results store no coordinates.

### Disconnect

Socket closed ⇒ presence `offline` after 30 s (stale after `staleAfterSec` without fixes). State is kept; player can rejoin any time before `finished`; no automatic penalty. Teammates see presence only.

## 9. Settings (Hide & Seek)

One zod schema in `src/shared/schemas/settings.ts` with defaults in `src/shared/defaults/`. Every field has: label key, help text key (`src/i18n/en.ts`), default, control type, validation, `dependsOn`. Groups: General, Timing, Roles, Map & zones, Location visibility, Capture, Jail & rescue, Scoring & winning, Boundaries & GPS, Notifications. Basic fields first; the rest under "Advanced". Cross-field validation (e.g. seekerCount < players, jail outcome ⇒ jail zone exists, ping interval ≥ 30 s, final reveal ≤ duration). Non-disableable: consent, server-side filtering, no location history, emergency stop.

Presets (built in): **Classic** (approx pings every 5 min, convert on capture, 30 min), **Manhunt + Jail** (jail with rescue, approx pings 4 min), **Shrinking Hunt** (3 shrink phases, approx pings 3 min), **Casual** (no pings, 20 min). Groups can save their own (settings and/or zone layouts), duplicate, delete, reset to defaults.

`simulation` flag: only allowed when server env `ALLOW_SIM_GPS=true` and `NODE_ENV !== 'production'`. Sim matches show a permanent TEST banner, accept `sim` fixes, and allow dev bots (server-side players that wander inside the play area and auto-confirm tags). Real matches reject sim fixes.

## 10. Client behaviour

- `navigator.geolocation.watchPosition` with `enableHighAccuracy`; send when moved ≥ 5 m or 10 s passed, never more often than every 2 s. Pauses when the tab is hidden (the browser does it anyway); on `visibilitychange` back, show "Tracking was paused" and resend immediately.
- Optional "Keep screen awake" (Screen Wake Lock API) during matches. No fake background tracking. Match setup and the consent screen explain clearly: phones stop sharing location when locked or in another app.
- Server time offset from `welcome`/`hbAck` (NTP-style midpoint), used for all countdowns.
- Vibration + in-app toast for key events where supported. Web Push is planned, not built.

## 11. Design system

- Feel: minimal, calm, premium, outdoor-readable. Map is the hero on the live screen; chrome stays out of its way.
- Type: IBM Plex Sans (UI) + IBM Plex Mono (timers, codes, numbers; tabular). IBM Plex Sans Arabic pairs later for RTL.
- Color tokens (CSS variables, light + dark via `prefers-color-scheme` and a manual toggle): neutral ink/paper scale, one accent **Signal Orange** `#FF5A1F` (primary actions, seeker team), **Hider Teal** `#0EA5A4`, status colors (success green, warning amber, danger red). Team colors are customisable later.
- Zones never rely on color alone: each type has a line style + icon label (main: solid outline, faint fill; safe: green, dotted outline, shield icon; restricted: red, hatched fill, no-entry icon; jail: violet, dashed, lock icon; rescue: cyan, dash-dot, life-buoy icon; spawn: flag icon; objective/capture/control/flag: star/target icons).
- Touch targets ≥ 44 px; bottom tab bar on mobile (Map | Players | Objectives | Events | Rules — hide irrelevant tabs); bottom sheets for detail; safe-area insets; `100dvh`.
- Motion: CSS first, `motion` for sheets/tab transitions; 150–250 ms ease-out; respect `prefers-reduced-motion`.
- **Target-lock role reveal** (the one showpiece animation): screen dims, all player avatars in a grid/ring; a crosshair reticle hops between avatars following `reveal.hops`/`hopMs` (fast → slow), `navigator.vibrate(8)` per hop where supported; on each seeker it snaps closed (scale 1.4 → 1, ~180 ms) with one ripple and the avatar turns Signal Orange. Then each phone shows its own full-screen role card: role name large, one-line goal, countdown (e.g. "SEEKER — find and tag every hider", "HIDER — run. Seekers are released in 5:00"). Reduced motion: no hops, crossfade straight to the result. Never a spinning wheel.
- Quick-start preset cards start a lobby in one tap; each card also has "Customize", which opens the full host settings prefilled from that preset.
- Logical CSS properties only (`ms/me/ps/pe/start/end`), `dir` on `<html>`, all strings from `src/i18n/en.ts`.

## 12. Definition of done (this build)

- `npm run dev` starts everything; a fresh clone runs with `npm install && npm run db:migrate && npm run dev`.
- `npm test` passes: unit tests (state machine, zone timeline, geometry/validation, boundary classifier, visibility/approximation, capture rules) and integration tests for prompt scenarios 1, 2, 3, 4, 5, 7, 8 against a real in-process server with WS clients.
- `npm run build` and `npm run typecheck` clean. Browser check at 375 px and desktop with no console errors.
- README with setup, run, phone testing over HTTPS (Cloudflare quick tunnel), free deployment (Render free + Turso free, or self-host + Cloudflare Tunnel), architecture rationale, GPS limitations, and an honest feature checklist.
