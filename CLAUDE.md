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

- GCE VM `35.239.156.16` (hostname `rba`, Debian 11), SSH as `pars` **with the GCE key** (`ssh -i ~/.ssh/google_compute_engine pars@35.239.156.16`) — the default key does NOT work. `pars` has passwordless sudo; docker needs `sudo`. Full infra reference: webai-server `server.md`.
- Repo checkout at `/var/www/webai-server`, runs as Docker container `webai`, port `3466`, public at **https://webai.pc.am**.
- Server pulls GitHub via deploy key `~/.ssh/webai_deploy` (ssh config host alias `github-webai-server`).
  - If `git pull` fails with `Permission denied (publickey)`: the deploy key is missing from GitHub → re-add `~/.ssh/webai_deploy.pub` as a **read-only deploy key** on `pars5555/webai-server` (happened 2026-07-16; re-added via API as `claude-server-deploy`).

## Deploy (webai-server)

```bash
# 1. commit + push to master
git push origin master
# 2. run deploy on the server
ssh -i ~/.ssh/google_compute_engine pars@35.239.156.16 'bash /var/www/webai-server/deploy.sh'
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

## Browser automation — always use the dedicated Edge instance on CDP port 9173

Any browser-driven task (Chrome Web Store / Play Console, admin panel, landing page, anything
requiring a logged-in session) **must** run in a separate Edge instance listening on remote
debugging port **9173**. Other sessions drive their own browsers, and sharing one profile mixes
up console state and logins.

Procedure, every time:

1. Check the port is alive: `GET http://127.0.0.1:9173/json/version`.
2. If it is not, launch a new instance and wait for the port:
   ```powershell
   Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList `
     "--remote-debugging-port=9173","--user-data-dir=C:\Users\pars\AppData\Local\EdgeCDP9173",`
     "--no-first-run","--no-default-browser-check"
   ```
   The dedicated `--user-data-dir` is what keeps this profile (and its logins) isolated.
3. Connect over CDP and work **only** in that instance — never the user's normal browser.

Interaction rules: drive the page with the CDP **DOM** and **Input** domains (read structure and
state via DOM, click/type via Input). Fall back to **Page.captureScreenshot** when the DOM alone
is not enough to tell what is on screen. The user logs in manually in this instance — do not try
to automate credential entry.

## Gotchas

- `landing/landing/` is a stale duplicate of the old landing page (old "AI Web Assistant" branding) — not served at root, safe to delete.
- `npm ci` on prod prints many audit vulnerabilities — known noise, not a deploy failure.
- webai-server `tmp/` holds ad-hoc user files (screenshots/PDFs) — keep untracked.
