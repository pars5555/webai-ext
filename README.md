# Claude Web Assistant — Chrome Extension

A Chrome extension that opens a floating, draggable AI chat panel on any webpage, powered by Anthropic's Claude. Connects to your local **Claude Code CLI** — use your existing Claude subscription with zero extra setup.

## Architecture

```
Chrome Extension  <──Native Messaging──>  Native Host (host.js)  <──spawn──>  Claude Code CLI
   (browser)          (stdin/stdout)        (Node.js process)                    (claude -p)
```

The extension communicates with Claude Code through a local bridge. Two connection modes:

- **Native Messaging** (recommended) — Chrome auto-launches the bridge process. One-time setup, zero manual steps after that.
- **HTTP Bridge** (fallback) — Run `node bridge.js` in a terminal. The extension connects via `localhost:3456`.

Both modes support **bidirectional tool calling**: Claude Code can request browser data (DOM, cookies, network, storage, CDP) from the extension in real-time.

### Conversation Persistence (--session-id / --resume)

Each chat message spawns a new `claude -p` process. Conversation continuity is maintained using Claude Code's built-in session persistence:

- **First message** in a tab: `claude -p --session-id <UUID> --system-prompt "..." "user message"`
- **Subsequent messages**: `claude -p --resume <UUID> "user message"`

Claude Code saves conversation history to disk and automatically reloads it on `--resume`, so the AI remembers the full conversation without us resending history.

### Auto-Execution Loop (CDP Agent)

When Claude outputs `cdp` or `js` code blocks, the extension automatically:
1. Executes the commands via Chrome DevTools Protocol
2. Sends the results back to Claude (via `--resume`)
3. Repeats up to 20 iterations

This enables Claude to autonomously interact with web pages — clicking buttons, reading DOM, typing into fields, etc.

### Direct API Key mode

You can also bypass Claude Code entirely and use an Anthropic API key directly. This skips the bridge and calls `api.anthropic.com` from the browser.

## Features

### Floating Chat Panel
- Resizable, draggable chat panel (380x520px) on any webpage
- Dark theme with smooth animations
- Markdown rendering with syntax-highlighted code blocks and copy buttons

### Browser Tools (bidirectional)
Claude has access to the current page through built-in chat commands:

| Command | Description |
|---------|-------------|
| `/dom` | Full page DOM structure |
| `/styles` | Computed styles for elements |
| `/errors` | Console errors |
| `/select` | Currently selected text |
| `/structure` | Page heading/landmark structure |
| `/highlight` | Highlight a DOM element by CSS selector |
| `/query` | Run a CSS selector query |
| `/network` | Captured network requests |
| `/cookies` | Cookies for the current domain |
| `/storage` | localStorage and sessionStorage |
| `/performance` | Page performance metrics |
| `/sources` | Page source, stylesheets, scripts |
| `/cdp` | Execute a Chrome DevTools Protocol command |
| `/clear` | Clear chat history |

### Chrome DevTools Protocol (CDP)
- Attach/detach the Chrome debugger via `chrome.debugger`
- Execute arbitrary CDP commands (e.g., `Runtime.evaluate`, `DOM.getDocument`)
- Optional auto-attach when chat opens

### Per-Page Toggle
- Enable/disable the extension per hostname via popup or settings
- Chat bubble hidden on disabled sites

## Project Structure

```
cloude_chrome_extension/
├── manifest.json                # MV3 manifest
├── background.js                # Service worker: message routing, native messaging, API, CDP
├── content.js                   # Content script: chat panel UI, commands, DOM interaction
├── styles.css                   # Chat panel styles (dark theme)
├── popup.html / popup.js        # Extension popup (status, open chat, per-page toggle)
├── options.html / options.js    # Settings page (auth, model, connection mode)
├── options.css                  # Settings page styles
├── bridge.js                    # HTTP bridge server (fallback mode)
├── install-host.js              # Native messaging host installer
├── native-host/
│   ├── host.js                  # Native messaging host process
│   └── com.claude.web_assistant.json  # Host manifest template
├── icons/                       # Extension icons (16, 48, 128px)
└── utils/
    ├── dom-inspector.js         # DOM queries, styles, errors, highlighting
    └── page-data-collector.js   # Cookies, storage, performance, sources
```

## Installation

### 1. Load the extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Note your **extension ID** (shown under the extension name)

### 2. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### 3a. Native Messaging setup (recommended)

```bash
node install-host.js --extension-id YOUR_EXTENSION_ID
```

Restart Chrome. The extension will auto-connect.

### 3b. HTTP Bridge setup (alternative)

```bash
node bridge.js
```

Keep the terminal open. The extension connects to `http://127.0.0.1:3456`.

### 3c. Direct API Key (no Claude Code needed)

1. Go to Settings > Authentication > API Key
2. Paste your `sk-ant-api03-...` key
3. Click Save

## Settings

Open Settings via the popup or right-click the extension icon > Options:

- **Connection mode**: Native Messaging or HTTP Bridge
- **Auth source**: Claude Code (Bridge) or API Key
- **Model**: Sonnet 4, Haiku 4.5, or Opus 4
- **Max tokens**: 1024–8192
- **Auto-attach CDP**: Auto-connect debugger when chat opens
- **Per-page hostnames**: Disable extension on specific sites

## Permissions

| Permission | Purpose |
|------------|---------|
| `nativeMessaging` | Communicate with local Claude Code bridge |
| `activeTab` | Access the active tab for chat |
| `scripting` | Inject content scripts |
| `storage` | Store settings and preferences |
| `tabs` | Detect tab URLs for per-page toggle |
| `debugger` | Chrome DevTools Protocol access |
| `cookies` | Read cookies for the current domain |
| `webRequest` | Log network requests |
| `webNavigation` | Track page navigation |
| `alarms` | Service worker keep-alive timer |
| `downloads` | File download access for Claude |
| `browsingData` | Clear browsing data on request |
| `history` | Access browser history |
| `bookmarks` | Access bookmarks |
| `topSites` | Access frequently visited sites |
| `notifications` | Show desktop notifications |
| `<all_urls>` | Content scripts on any page |

## Known Issues & TODO

### Persistent Session Chat (stream-json stdin buffering)

**Status**: Not yet working. Code preserved in `native-host/host.js` (search for "EXPERIMENTAL").

**Goal**: Keep one long-running `claude` process alive per tab using `--input-format stream-json`, so messages are piped via stdin without spawning a new process each time. This would eliminate the ~1-2s process spawn overhead per message and enable truly real-time multi-turn conversations.

**The Problem**: `claude -p --input-format stream-json --output-format stream-json` buffers ALL stdin until EOF before processing. The process never starts generating a response while stdin is open. We confirmed this with a test script — after sending a JSON message + newline, the process produced zero output for 15+ seconds. Only after calling `stdin.end()` did it process (and even then produced no stdout).

Without `-p`, Claude tries to start interactive TUI mode which doesn't work with piped stdin/stdout — process hangs with no output.

**What We Tried**:
- `claude -p --input-format stream-json` — buffers until EOF, no streaming
- `claude --input-format stream-json` (no `-p`) — hangs in TUI mode
- `shell: false` with direct binary path — same behavior
- `--include-partial-messages` flag — no effect on input buffering

**Possible Solutions to Explore**:
1. Send EOF programmatically after each message but keep the native host session alive (essentially one-shot with faster resume since the host process persists)
2. Find an undocumented CLI flag or environment variable that enables true streaming input mode
3. Use the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) in Node.js instead of spawning the CLI binary — this would give full programmatic control over the conversation
4. Investigate if `--input-format stream-json` works differently in a PTY (pseudo-terminal) vs piped stdin
5. File a feature request with Anthropic for a persistent non-interactive streaming mode in the CLI

**Current Workaround**: One-shot `claude -p` with `--session-id` (first message) and `--resume` (subsequent messages). Claude Code manages conversation history internally. Works reliably but adds ~1-2s process spawn time per message.

## Uninstalling the native host

```bash
node install-host.js --uninstall
```
