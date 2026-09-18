# lists

Lists with items — create a list, add to it, check things off, delete them.

One SQLite store and one HTTP service, shared by three surfaces: a web app, an
iOS app, and the MCP tools. Every write goes through the service, so the three
cannot disagree about what a save means.

## Layout

| Path | What |
|---|---|
| `src/db.ts` | SQLite, opened at `BARRY_LISTS_DB ?? $BARRY_HOME/lists.db ?? ~/.barry/lists.db` |
| `src/store.ts` | The data layer — the only place that writes SQL |
| `src/client.ts` | How the tools reach the service |
| `src/tools.ts` | MCP tools (re-exported by `tools.ts` at the root) |
| `server/src/index.ts` | The service: `node:http`, loopback, port 4885 |
| `web/` | The web app — hand-written HTML/CSS/JS, no build step |
| `lists-ios/` | The iOS app (XcodeGen; `project.yml` is the source of truth) |

## Running it

```sh
pnpm install
pnpm start          # http://127.0.0.1:4885
pnpm test           # store + service
pnpm typecheck
```

The service reads `BARRY_SECRET`. With one bound it requires
`Authorization: Bearer <secret>` (or `x-barry-secret`) on every `/api/` route;
`/health` never takes auth, so a probe can tell "server down" from "wrong
secret". With no secret bound it is open — correct on loopback only.

## The iOS app

```sh
cd lists-ios && ./scripts/test.sh          # build + unit tests on a simulator
barry ios build lists --simulator "iPhone 16 Pro"
barry ios build lists --device
```

On the simulator it talks to `127.0.0.1:4885` with no secret. On a device it
goes over Tailscale to Caddy, which selects the `lists.barry.lan` vhost from
the `Host` header — a raw service port is not reachable from a phone. The
tailnet address and the secret are both editable in Settings; find the current
address with `tailscale ip -4`.

## Reaching it from outside the tailnet

`services.web.tunnel` publishes `lists.barry.rocks` through the shared
cloudflared tunnel. That origin has no auth of its own beyond `BARRY_SECRET`,
so the Cloudflare Access application is the gate between the internet and this
store, and **must be applied before the hostname resolves**. See
`bags/cloudflare/infra/`.
