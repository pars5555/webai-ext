# WebAI — Chrome Extension

Chrome MV3 extension that puts Claude AI in your browser's side panel. Claude can see page content, execute JavaScript, control the browser via Chrome DevTools Protocol (CDP), and automate multi-step tasks.

Connects to the [claude-server](../claude-server/) backend (webai.pc.am) for authentication, billing, system prompt, and Anthropic API proxying.

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
│  │ Auto-exec    │  │ Tab mgmt     │  │ Performance      │  │
│  │ Markdown     │  │ Network log  │  │ Canvas capture   │  │
│  │ File upload  │  │ OAuth flow   │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         │                 │                  │               │
│         │  chrome.runtime │  chrome.debugger │ DOM access    │
└─────────┼─────────────────┼──────────────────┼──────────────┘
          │                 │                  │
          │ fetch SSE       │ CDP commands     │ page context
          ▼                 ▼                  ▼
┌─────────────────────┐  ┌──────────────────────────────┐
│ API Server          │  │ Browser Tab (target page)    │
│ webai.pc.am         │  │ JS eval, DOM read/write      │
│ POST /api/chat      │  │ Screenshots, navigation      │
│ JWT auth + billing  │  │ Click, type, scroll          │
│ Anthropic proxy     │  │ Network, cookies, storage    │
│ DB system prompt    │  └──────────────────────────────┘
└─────────────────────┘
```

## Full Chat Flow

```
1. User types message in side panel
   ↓
2. sidepanel.js gathers page context from content.js
   (URL, title, headings, selected text, console errors, etc.)
   ↓
3. POST /api/chat (SSE) to server with:
   - messages[] (conversation history)
   - pageContext {} (structured page data)
   - model, maxTokens, tabId
   - Authorization: Bearer <JWT>
   ↓
4. Server (chat.js):
   - Validates JWT, checks trial/balance
   - Gets system prompt from DB (admin-configured, includes CDP instructions)
   - Appends pageContext to system prompt
   - Streams to Anthropic API → SSE back to extension
   ↓
5. sidepanel.js renders response with markdown + syntax highlighting
   ↓
6. If response contains ```cdp or ```js code blocks:
   → sidepanel.js extracts commands
   → Sends CDP_COMMAND to background.js
   → background.js attaches debugger (auto) and executes via chrome.debugger
   → Results formatted and sent back to server as follow-up message
   → Loop repeats (up to maxAutoFollowUps iterations, default 40)
   ↓
7. When no more CDP/JS blocks → task complete, user can type next message
```

### CDP Auto-Execution Loop

The AI uses the DB system prompt (configured in admin panel) which instructs it to output CDP/JS commands in fenced code blocks. The extension automatically:

1. Parses `\`\`\`cdp` blocks as JSON CDP commands (`{"method": "...", "params": {...}}`)
2. Parses `\`\`\`js` / `\`\`\`javascript` blocks as JavaScript to run via `Runtime.evaluate`
3. Executes each command through `background.js → chrome.debugger.sendCommand()`
4. Formats results and sends them back to the AI as a follow-up user message
5. The AI analyzes results and either sends more commands or gives a final answer
6. Loop continues up to `maxAutoFollowUps` iterations per user message (configurable in admin, default 40)

This enables Claude to autonomously: click buttons, fill forms, read DOM, navigate pages, take screenshots, analyze network requests, inspect cookies/storage, and more.

## Features

- **Side panel chat** with streaming responses and markdown rendering
- **Per-tab conversations** — each browser tab has isolated chat history
- **Browser automation** — Claude clicks, types, scrolls, navigates using CDP
- **Page context** — DOM, cookies, network requests, localStorage, performance metrics
- **File attachments** — images, PDFs, text files, code files (drag & drop or paste)
- **Auto-execution** — Claude runs CDP/JS commands in a loop until task complete
- **Multi-user auth** — anonymous 5-min trial, email/password, Google/GitHub OAuth
- **Usage tracking** — per-request token counting and cost calculation
- **Context management** — auto-compaction when approaching 200K token limit
- **Syntax highlighting** — code blocks with language-specific coloring
- **Tool result blocks** — collapsible sections showing CDP commands and results

## Setup

### 1. Install the extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select this directory (`claudeCodeExtension/`)

### 2. API Server

The extension connects to `https://webai.pc.am` by default. For local development:

```bash
cd ../claude-server
cp .env.example .env
# Edit .env: set MySQL credentials, JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY
npm install
npm run dev
```

Then change server URL in extension Options to `http://localhost:3466`.

### 3. Use the extension

1. Click the extension icon → side panel opens
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

## File Structure

```
claudeCodeExtension/
├── manifest.json               # MV3 config, permissions, side panel
├── background.js               # Service worker: CDP, message router, OAuth
├── sidepanel.html              # Chat UI + auth overlay
├── sidepanel.js                # Chat logic, auth, SSE, auto-exec loop, markdown
├── sidepanel.css               # Dark theme, chat bubbles, auth overlay
├── content.js                  # Page context, DOM commands, command execution
├── popup.html                  # Extension popup (status, open chat)
├── popup.js                    # Popup logic (auth status, server check)
├── options.html / options.js   # Settings page (server URL)
├── options.css                 # Settings styles
├── styles.css                  # Shared styles
├── utils/
│   ├── dom-inspector.js        # DOM structure, headings, meta, selected text
│   └── page-data-collector.js  # Performance, security, cookies, network
└── icons/                      # Extension icons (16, 48, 128px)
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
| `/cookies` | Page cookies (document + Chrome API) |
| `/storage` | localStorage + sessionStorage |
| `/performance` | Performance metrics |
| `/sources` | Page HTML and scripts |
| `/network` | Recent network requests |
| `/cdp <method> [params]` | Manual CDP command |
| `/logs` | Extension debug logs |
| `/clear` | Clear chat history |

---

## CDP Commands (AI-Generated)

Claude writes fenced code blocks that the extension auto-executes:

**JavaScript** (via Runtime.evaluate):
```js
document.querySelector('.price').textContent
```

**CDP** (direct Chrome DevTools Protocol):
```json
{"method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "x": 100, "y": 200, "button": "left"}}
```

Common operations: click, type, navigate, screenshot, scroll, evaluate JS, read DOM, inspect network, manage cookies.

---

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access current tab URL/title |
| `scripting` | Inject content scripts |
| `storage` | Auth tokens, settings |
| `tabs` | Tab management, per-tab chat |
| `debugger` | CDP access (auto-attach) |
| `cookies` | Read page cookies |
| `webRequest` | Network request logging |
| `webNavigation` | Page load tracking |
| `alarms` | Service worker keep-alive |
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

## API Communication

| Feature | Endpoint | Method |
|---------|----------|--------|
| Auth | `/api/auth/*` | POST |
| Chat (streaming) | `/api/chat` | POST (SSE) |
| Settings | `/api/user/settings` | GET |
| System prompt | `/api/user/prompt` | GET |
| Sessions | `/api/sessions` | POST/GET |
| Logs | `/api/logs/*` | POST |

Extension handles locally (background.js):
- CDP command execution via `chrome.debugger`
- Page context gathering (content.js)
- Tab management (list, switch, create, close)
- Network request logging
- OAuth web auth flow

---

## Related

- [claude-server](../claude-server/) — Backend API server (authentication, billing, admin panel, Anthropic proxy)
