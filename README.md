# AutoClaim

Claims the daily attendance points on xm100.vn once a day, for as many accounts
as you like, and keeps a log of every attempt with exactly what the server said
back.

## Why there's a server

The browser can't do this on its own. `connect.sid` is an HttpOnly cookie for
`xm100.vn`, so a page served from localhost can neither read it nor attach it to
a cross-origin request, and the browser would block the response anyway. So the
React app is just the front end: a small Node service holds the cookies, makes
the calls, runs the schedule and owns the log.

## Running it

```bash
npm install
npm run build
npm start
```

Then open http://127.0.0.1:8787.

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

The container exposes port 8787 and stores profile data in server/data via a bind mount so cookies and logs persist between restarts.

For development with hot reload, run the two halves separately:

```bash
npm run dev:server   # API on :8787
npm run dev:web      # UI on :5173, proxies /api to the server
```

## Docker

```bash
docker compose up -d --build
```

Then open http://127.0.0.1:8787. Logs with `docker compose logs -f`.

A few things are deliberate rather than incidental:

**The published port is bound to host loopback.** The container listens on
`0.0.0.0` because it has to be reachable from outside its own network
namespace, but `compose.yml` publishes it as `127.0.0.1:8787:8787`. The app has
no authentication of its own and holds live session cookies, so anything that
can reach the port owns the accounts. Don't widen that to `0.0.0.0` without
putting an authenticating proxy in front.

**Profiles are bind-mounted** from `./server/data` to `/data` (`DATA_DIR`), so
the container shares the same profiles and log as a plain `npm start` and
existing ones need no migration. The mount path has to match `DATA_DIR`;
mounting over `/app/server/data` instead would silently do nothing, because the
app no longer reads from there. The host directory must be owned by uid 1000 to
match the image's `node` user. `server/data` is in `.dockerignore`, so local
cookies are never baked into an image.

**Full ICU is asserted at build time.** Day rollover is computed with `Intl` in
an explicit timezone, and a base image with small-icu would throw on
`Asia/Ho_Chi_Minh`. The build fails immediately and says so, rather than the
container dying at midnight.

`restart: unless-stopped` matters more here than for most apps: a container
that's down over midnight UTC+7 misses that day for good, since there's no
backfill.

If you would rather keep the data inside Docker than on the host, swap the mount
for a named volume — but then profiles added before the switch don't come across
until you copy them in:

```yaml
volumes:
  - autoclaim-data:/data
```

```bash
docker compose cp server/data/config.json autoclaim:/data/config.json
```

## Profiles

Each profile is one account: its own cookie, its own server type, its own
auto-claim switch, its own once-a-day bookkeeping. Add one by pasting its
`connect.sid` and the app immediately calls `/api/auth/status` to read back who
it belongs to, so the card shows the username, nickname, points, Xcoin and VIP
tier rather than an opaque token. "Refresh account" re-reads those numbers.

Get the cookie from devtools on xm100.vn: Application → Cookies →
`connect.sid`. It accepts whatever shape you copy - the decoded `s:abc.def` that
devtools displays, the percent-encoded `s%3Aabc.def` that goes on the wire, or a
whole `connect.sid=...; Path=/` line - and normalises it.

Cookies live in `server/data/config.json` (mode 600, gitignored) and are never
sent back to the browser in full, only as a masked preview. Session cookies
expire; when a profile starts logging `auth` rows it flags itself as expired and
you paste a fresh one into that profile's Edit panel.

## Hosting on Oracle Cloud (Always Free)

```bash
ssh -i ~/.ssh/oci_autoclaim ubuntu@<ip> 'bash -s' < deploy/bootstrap.sh
deploy/push.sh <ip>
```

`bootstrap.sh` adds swap and installs Docker; `push.sh` syncs the source, seeds
`server/data/config.json` if the instance doesn't already have one, and starts
compose.

**The UI is never exposed to the internet.** The VCN security list allows port
22 and nothing else, and compose publishes 8787 on the instance's own loopback.
Reach it with a tunnel:

```bash
ssh -i ~/.ssh/oci_autoclaim -L 8787:127.0.0.1:8787 ubuntu@<ip>
```

then open http://127.0.0.1:8787. This matters because the app has no
authentication of its own and holds live session cookies; anything that can
reach port 8787 can claim as you, or lift the cookies outright. The scheduler
needs no inbound access at all to do its job, so there is nothing to gain by
opening it up.

Staying inside the free tier comes down to shape choice. `VM.Standard.E2.1.Micro`
is the safest, because the tenancy limit for it (2) is exactly the Always Free
allowance, so it cannot overspend. `VM.Standard.A1.Flex` is the better machine
but its limit is far above the free allowance (2 OCPU / 12 GB, metered as 1,500
OCPU-hours and 9,000 GB-hours a month), so it must be sized deliberately - 1
OCPU and 6 GB leaves comfortable margin at 730 and 4,380 hours.

Expect `Out of host capacity` on both. The free shapes are heavily
oversubscribed, and Always Free is only offered in the tenancy's home region, so
there is no other region or AD to fall back to. Retrying on a loop until one
frees up is the normal way through it.

## Steam and Epic

xm100.vn credits attendance points to a game account, and an ARK player arrives
through either Steam or Epic. `/api/auth/status` reports both - `steam_id` and
`eos_id` (Epic Online Services) - and each profile card shows which of the two
is attached.

If neither is linked the site refuses the claim with *"Bạn chưa liên kết tài
khoản Steam"*. That is a permanent condition, not a hiccup: it is logged as
`unlinked`, no further attempts are made that day, and it does not eat into the
retry budget. When the linkage is already known to be missing the request isn't
sent at all. The only fix is to link the account on xm100.vn itself - nothing
this app sends can work around it.

## How the schedule works

A day is a calendar day in `Asia/Ho_Chi_Minh` by default, not wherever your
machine is. xm100.vn is a Vietnamese site, so its attendance day almost
certainly rolls over at midnight UTC+7; using local midnight would fire at the
wrong time. Change it in the bar at the top if that turns out to be wrong.

The loop wakes every 5 minutes and asks, per profile, whether today has been
claimed yet - rather than sleeping for 24 hours. That means:

- a restart, a reboot or a closed laptop lid can't lose its place; the log on
  disk is the source of truth
- the first tick after midnight claims the new day
- once a profile has claimed a day it is left alone until the next one starts
- if the server says "already claimed", that counts as settled too
- a profile that keeps erroring is retried 6 times, then left until tomorrow
- profiles are claimed one at a time, 2s apart, never in a burst

The machine has to be awake for a claim to fire. If it's off across a rollover,
that day is missed - the app claims today, it does not backfill.

## The log

| Outcome | Meaning |
| --- | --- |
| `claimed` | The request succeeded. |
| `already` | The server says this day was already claimed. Treated as done. |
| `unlinked` | No game account is linked, so points have nowhere to go. Terminal for the day. |
| `failed` | Rejected, timed out, or a network error. Will retry. |
| `auth` | Session rejected (HTTP 401/403, or an HTML login page). Paste a new cookie. |

The API answers in Vietnamese, so messages are translated to English for
display, with the original kept next to it (`Checked in successfully · server
said "Điểm danh thành công"`). Anything the translation table doesn't recognise
is passed through untouched rather than mangled.

The API's exact response contract isn't documented anywhere, so `failed` vs
`already` is decided from status codes first and phrasing second (matching both
English and Vietnamese, diacritics stripped). Every row keeps the raw response
body - click a row to expand it - so if a verdict is ever wrong you can see
precisely what came back rather than trusting the guess.

## Layout

```
server/
  index.js      HTTP API, serves the built UI in production
  scheduler.js  the once-a-day loop and its guards
  upstream.js   the calls to xm100.vn, response classification, translation
  config.js     profiles, cookie normalisation and masking
  log.js        capped append-only log (1000 entries)
  dates.js      timezone-aware day maths
  data/         gitignored: config.json, log.json (override with DATA_DIR)
web/            React + Vite front end
Dockerfile      two stages: build the UI, then a runtime with only express
compose.yml     loopback-published port, named volume, restart policy
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. The image sets `0.0.0.0`. |
| `DATA_DIR` | `server/data` | Where profiles and the log are kept. |
| `CLAIM_TIMEZONE` | `Asia/Ho_Chi_Minh` | Zone the attendance day rolls over in. |
| `CONNECT_SID` | – | Seeds a first profile on a fresh install only. |
| `SERVER_TYPE` | `ase` | Server type for that seeded profile. |

The service binds to `127.0.0.1` only. It holds live session cookies, so nothing
about it should be reachable from the network.
