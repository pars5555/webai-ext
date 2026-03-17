# Claude Web Assistant — Chrome Extension

Chrome MV3 extension that puts Claude AI in your browser's side panel. Claude can see page content, execute JavaScript, control the browser via Chrome DevTools Protocol (CDP), and automate multi-step tasks.

Connects to the [claude-server](../claude-server/) backend for multi-user authentication, billing, and Anthropic API proxying. Also supports a local Claude Code CLI bridge for development.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Extension                                           │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ sidepanel.js │  │ background.js│  │ content.js       │  │
│  │ Chat UI      │  │ Service      │  │ Page data        │  │
│  │ Auth/login   │  │ Worker       │  │ DOM inspector    │  │
│  │ SSE stream   │  │ CDP control  │  │ Cookie/storage   │  │
│  │ Markdown     │  │ Auto-exec    │  │ Performance      │  │
│  │ File upload  │  │ Native host  │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         │  Chrome APIs    │  chrome.debugger (CDP)           │
└─────────┼─────────────────┼──────────────────────────────────┘
          │                 │
          │ fetch SSE       │ CDP commands
          ▼                 ▼
┌─────────────────────┐  ┌──────────────────────┐
│ API Server          │  │ Browser Tab          │
│ (claude-server)     │  │ Target page          │
│ POST /api/chat      │  │ JS eval, DOM access  │
│ JWT auth            │  │ Screenshots          │
│ Anthropic proxy     │  │ Click/type/scroll    │
└─────────────────────┘  └──────────────────────┘
```

### Connection Modes

1. **Server Mode** (default) — Extension connects to `claude-server` via HTTP/SSE. Server proxies to Anthropic API. Multi-user auth, billing, admin dashboard.
2. **Native Messaging** (legacy/dev) — Chrome auto-launches local bridge process that spawns Claude Code CLI. No server needed.
3. **HTTP Bridge** (legacy/dev) — Run `node bridge.js` locally, extension connects via `localhost:3456`.

### Auto-Execution Loop (CDP Agent)

When Claude outputs `cdp` or `js` code blocks, the extension automatically:
1. Executes the commands via Chrome DevTools Protocol
2. Sends the results back to Claude (auto-follow-up)
3. Repeats up to 40 iterations

This enables Claude to autonomously interact with web pages — clicking buttons, reading DOM, typing into fields, taking screenshots, navigating.

## Features

- **Side panel chat** with streaming responses and markdown rendering
- **Per-tab conversations** — each browser tab has isolated chat history
- **Browser automation** — Claude clicks, types, scrolls, navigates using CDP
- **Page context** — DOM, cookies, network requests, localStorage, performance metrics
- **File attachments** — images, PDFs, text files, code files
- **Auto-execution** — Claude runs CDP/JS commands in a loop until task complete
- **Multi-user auth** — anonymous 5-min trial, email/password, Google/GitHub OAuth
- **Usage tracking** — per-request token counting and cost calculation
- **Context management** — auto-compaction when approaching token limit
- **Syntax highlighting** — code blocks with language-specific highlighting
- **Tool blocks** — collapsible sections showing CDP commands and results

## Setup

### 1. Install the extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select this directory (`claudeCodeExtension/`)

### 2. Start the API server

The extension requires the [claude-server](../claude-server/) backend:

```bash
cd ../claude-server
cp .env.example .env
# Edit .env: set MySQL credentials, JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY
npm install
npm run dev
```

Server runs at `http://localhost:3466`.

#### Docker alternative

```bash
cd ../claude-server
cp .env.example .env
# Edit .env (set DB_HOST=host.docker.internal for Docker)
docker compose up --build
```

#### MySQL setup

The server auto-creates the `webai` database and all 14 tables. Just make sure MySQL/MariaDB is running:

```bash
# XAMPP
# Start MySQL from XAMPP Control Panel

# Or standalone
mysql -u root
# Server will CREATE DATABASE webai automatically
```

### 3. Configure server URL (optional)

Default is `http://localhost:3466`. To change:
- Open extension Options page (right-click extension icon → Options)
- Or set in `chrome.storage.sync`: `chrome.storage.sync.set({ serverUrl: 'https://your-server.com' })`

### 4. Create admin user (first time)

1. Open the extension side panel → Sign Up with email/password
2. Promote to admin in MySQL:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
   ```
3. Open `http://localhost:3466` → login with admin credentials → full admin panel

### 5. Use the extension

1. Click the extension icon → "Open Chat"
2. Choose "Try Free" (5-min trial) or sign in
3. Start chatting — Claude sees the current page and can interact with it

---

## Authentication Flow

### Anonymous Trial (5 minutes)
- "Try Free" button → generates browser fingerprint → gets 5-min JWT
- Max 3 trials per fingerprint per 24 hours
- Countdown timer shown in header
- When expired → sign-in overlay

### Email/Password
- Sign up: email + password (min 6 chars) + optional display name
- Sign in: email + password
- JWT access token (15 min) in `chrome.storage.local`
- Refresh token (30 days) for seamless re-auth

### OAuth (Google / GitHub)
- "Continue with Google/GitHub" button
- Uses `chrome.identity.launchWebAuthFlow`
- Server handles OAuth redirect flow, returns tokens

### Token Management
- `Authorization: Bearer <token>` on every API call
- 401 → automatic refresh → retry original request
- 402 → "insufficient balance" message
- 403 → trial expired → show sign-in overlay

---

## Chat Flow

```
User types message
  ↓
sidepanel.js collects page context from background.js
  ↓
POST /api/chat (SSE) with Bearer token
  ↓
Server validates auth → streams to Anthropic → SSE back
  ↓
sidepanel.js renders markdown incrementally
  ↓
If response has CDP/JS blocks + auto-execute on:
  → background.js executes CDP commands
  → Results added to conversation
  → New POST /api/chat (auto-follow-up loop, max 40x)
```

### Server-Side Processing
1. Validates JWT, checks trial/balance
2. Resolves API key: user's own (encrypted) → platform key
3. Balance check if platform key
4. Gets settings (global + user overrides) and system prompt
5. Logs user message, streams to Anthropic
6. Records usage, deducts balance, logs assistant response

---

## File Structure

```
claudeCodeExtension/
├── manifest.json               # MV3 config, permissions, scripts
├── background.js               # Service worker: CDP, native host, auto-exec, OAuth
├── sidepanel.html              # Chat UI + auth overlay
├── sidepanel.js                # Chat logic, auth, SSE streaming, markdown
├── sidepanel.css               # Dark theme, auth overlay, chat bubbles
├── content.js                  # Page context, DOM commands
├── popup.html                  # Extension popup (status, auth, open chat)
├── popup.js                    # Popup logic (auth status, server check)
├── options.html / options.js   # Settings page
├── options.css                 # Settings styles
├── bridge.js                   # HTTP bridge (legacy dev mode)
├── install-host.js             # Native host installer
├── utils/
│   ├── dom-inspector.js        # DOM structure/context gathering
│   └── page-data-collector.js  # Performance, security, network data
├── icons/                      # Extension icons (16, 48, 128px)
├── native-host/                # Claude Code CLI bridge
│   ├── host.js
│   ├── host.bat
│   └── com.claude.web_assistant.json
└── server/                     # OLD embedded admin panel (replaced by claude-server)
```

---

## Chat Commands

| Command | Description |
|---------|-------------|
| `/dom` | Full page context (DOM, cookies, performance) |
| `/styles <selector>` | Computed CSS for an element |
| `/errors` | Console errors |
| `/select` | Currently selected text |
| `/structure` | DOM tree overview |
| `/highlight <selector>` | Highlight an element visually |
| `/query <expr>` | Execute JavaScript expression |
| `/cookies` | Page cookies |
| `/storage` | localStorage + sessionStorage |
| `/performance` | Performance metrics |
| `/sources` | Page HTML and scripts |
| `/clear` | Clear chat history |

---

## CDP Commands

Claude writes code blocks that get auto-executed:

**JavaScript** (read-only):
```js
document.querySelector('.price').textContent
```

**CDP** (interactions):
```json
{"method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "x": 100, "y": 200, "button": "left"}}
```

Common operations: click, type, navigate, screenshot, scroll, evaluate JS.

---

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access current tab URL/title |
| `scripting` | Inject content scripts |
| `storage` | Auth tokens, settings |
| `tabs` | Tab management |
| `debugger` | CDP access |
| `cookies` | Read page cookies |
| `webRequest` | Network request logging |
| `webNavigation` | Page load tracking |
| `nativeMessaging` | Claude Code CLI bridge |
| `alarms` | Service worker keep-alive |
| `downloads` | File downloads |
| `browsingData` | Clear data commands |
| `history` | Browser history access |
| `bookmarks` | Bookmark access |
| `topSites` | Top sites |
| `notifications` | Desktop notifications |
| `sidePanel` | Side panel API |
| `identity` | OAuth web auth flow |
| `<all_urls>` | Content scripts on any page |

---

## Context Management

- 200K token context window per model
- Token usage displayed in context meter bar
- "Compact" button summarizes conversation history
- Auto-compaction: keeps first + last 2 messages, summarizes middle
- Token estimation: `characters / 4`

---

## Development

### Reload after changes
1. Edit files
2. `chrome://extensions/` → click reload on the extension
3. Reopen side panel

### Debug
- **Side panel**: Right-click side panel → Inspect
- **Background**: Click "Service Worker" on `chrome://extensions/`
- **Content script**: Normal DevTools (F12)

### Logs
Extension pushes logs to server at `POST /api/logs/system`. View in admin panel → System Logs.

---

## API Server Communication

| Feature | Endpoint | Method |
|---------|----------|--------|
| Auth | `/api/auth/*` | POST |
| Chat (streaming) | `/api/chat` | POST (SSE) |
| Settings | `/api/user/settings` | GET |
| System prompt | `/api/user/prompt` | GET |
| Sessions | `/api/sessions` | POST/GET |
| Logs | `/api/logs/*` | POST |

Background.js handles locally:
- CDP command execution
- Page context (DOM, cookies, network)
- Native messaging bridge (dev mode)
- Tab management
- Auto-execution loop

---

## Legacy: Native Messaging (Claude Code CLI)

For development without the server:

### Install Native Host
```bash
node install-host.js --extension-id YOUR_EXTENSION_ID
```

### HTTP Bridge (alternative)
```bash
node bridge.js
# Runs on http://127.0.0.1:3456
```

### Uninstall Native Host
```bash
node install-host.js --uninstall
```

---

## Related

- [claude-server](../claude-server/) — Backend API server (authentication, billing, admin panel, Anthropic proxy)
