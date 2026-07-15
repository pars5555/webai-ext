# WebAI — Project Guide (cross-repo)

Product: **WebAI** — AI browser assistant. Chrome extension + backend server.
Published on Chrome Web Store as **"AI Web Assistant"** (id `ojhlpkiegeembmefmfhbnhhgdcppmdfg`).

## Repos

| Repo | Local path | GitHub | Notes |
|------|-----------|--------|-------|
| webai-ext | `d:\xampp\htdocs\webai-ext` | `pars5555/webai-ext` | MV3 Chrome extension |
| webai-server | `d:\xampp\htdocs\webai-server` | `pars5555/webai-server` | Express backend + landing site + admin |

- `master` = production on both repos. Extension also has `release/vX.Y.Z` branches; packaged builds as `webai-ext-vX.Y.Z.zip`.
- Git pushes use HTTPS + Windows credential manager and just work. The `gh` CLI keyring token is **invalid** — use plain `git`, not `gh`. If a GitHub API call is needed, extract the working token with `git credential fill` (protocol=https, host=github.com).

## Production server

- GCE VM `35.238.47.14`, SSH as `pars` (default local key authenticates, BatchMode works).
- Repo checkout at `/var/www/webai-server`, runs as Docker container `webai`, port `3466`, public at **https://webai.pc.am**.
- Server pulls GitHub via deploy key `~/.ssh/webai_deploy` (ssh config host alias `github-webai-server`).
  - If `git pull` fails with `Permission denied (publickey)`: the deploy key is missing from GitHub → re-add `~/.ssh/webai_deploy.pub` as a **read-only deploy key** on `pars5555/webai-server` (happened 2026-07-16; re-added via API as `claude-server-deploy`).

## Deploy (webai-server)

```bash
# 1. commit + push to master
git push origin master
# 2. run deploy on the server
ssh pars@35.238.47.14 'bash /var/www/webai-server/deploy.sh'
```

- Quick deploy = git pull + `npm ci` in container + `docker compose restart` + health check.
- `--rebuild` = no-cache Docker rebuild. Auto-rebuilds when `Dockerfile`/`package*.json` changed.
- `--branch <name>` deploys another branch.
- Docs-only changes don't need a deploy; they land with the next one.
- The extension has no deploy — publish through the Chrome Web Store dashboard.

## Server layout (webai-server)

- Entry: `src/server.js`. Landing site served statically from `landing/` with SPA fallback `*` → `landing/index.html`. Admin panel from `public/` at `/admin`.
- `/privacy` → serves `landing/privacy.html` (full policy). `/terms` → inline HTML in `server.js`. Both registered on the Google OAuth consent screen — keep the URLs stable.
- User login OAuth (Google/GitHub): `passport` strategies in `src/routes/auth.js`; client id/secret live in the **DB `settings` table** (`oauth_google`), managed via the admin panel — not in env/code.
- Extension login flow: sidepanel → background `OAUTH_FLOW` → `chrome.identity.launchWebAuthFlow` → server `/api/auth/oauth/:provider` → tokens returned in redirect URL.
- Default server URL is hardcoded in the extension (`background/background.js` `ADMIN_PANEL_URL`, `sidepanel/sidepanel.js` `SERVER_URL`), overridable via options page `devConfig.server`.

## Google OAuth branding (GCP project "Gemini API", account vahagnsookiasyan@gmail.com)

- Consent screen app name is **WebAI** and the logo says WebAI. The homepage (`landing/index.html`) must keep **WebAI** as the prominent displayed name (title, h1, footer) — Google verification fails on any mismatch. "AI Web Assistant" is only used as the Chrome Web Store listing descriptor.
- Search Console ownership is verified via HTML file **`landing/google5fe94e20da6c70a3.html` — never delete it** (it's committed to git).
- Consent screen URLs: home `https://webai.pc.am`, privacy `/privacy`, terms `/terms`.
- Brand re-verification requested 2026-07-16 after fixing: (1) homepage ownership, (2) app name mismatch.

## Gotchas

- `landing/landing/` is a stale duplicate of the old landing page (old "AI Web Assistant" branding) — not served at root, safe to delete.
- `npm ci` on prod prints many audit vulnerabilities — known noise, not a deploy failure.
- webai-server `tmp/` holds ad-hoc user files (screenshots/PDFs) — keep untracked.
