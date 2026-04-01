# AI Web Assistant (wAi) — Chrome Extension

AI-powered browser assistant. Chat with Claude and Gemini to interact with any webpage via a side panel.

## Architecture

```
webai-ext/                     Chrome extension (this repo)
  background/background.js     Service worker: CDP bridge, OAuth, network capture
  content/content.js           Content script: DOM inspection, page commands
  content/utils/               DOM inspector, page data collector
  sidepanel/                   Main chat UI (5 files)
    sidepanel.html             Entry HTML
    sidepanel.js               Entry point: shared state, DOM refs, auth, event listeners
    ui.js                      Rendering, markdown, syntax highlighting, button state
    sessions.js                Session management, tab tracking, files drawer
    commands.js                CDP/JS/ext execution, slash commands, result formatting
    streaming.js               SSE streaming, message queue, stream handlers
  popup/                       Extension popup (open side panel shortcut)
  options/                     Settings page (theme, dev config)

webai-server/                  Express.js backend (separate repo)
  Server-side chat, billing, auth, admin dashboard
```

## How It Works

1. User opens the side panel and authenticates (Google/Apple/GitHub OAuth)
2. Each browser tab gets its own chat session with a persistent DOM container
3. User sends a message — the extension collects page context (URL, headings, visible elements, cookies) and sends it to the server via SSE
4. Server routes to Claude or Gemini based on selected model, streams the response back
5. AI responses containing fenced code blocks (`js`, `cdp`, `ext`, `bash`, `webfetch`, `websearch`, `captcha`) are auto-executed:
   - **js** — evaluated on the page via `Runtime.evaluate` (CDP)
   - **cdp** — raw Chrome DevTools Protocol commands
   - **ext** — Chrome extension API calls (tabs, history, etc.)
   - **bash** — executed in a server-side sandbox
   - **webfetch/websearch** — server-side HTTP fetch / search
   - **captcha** — loads specialized solver instructions from server
6. Execution results are sent back to the AI as a follow-up message, creating an autonomous loop (up to 100 steps)
7. The loop ends when the AI responds with no executable code blocks, or the user clicks Stop

## Prompt System

The extension supports multiple prompt types, each loading a different system prompt from the server database.

### How Prompt Types Work

**Database (`system_prompt` table):**
- Each prompt has a `type` (e.g. `general`, `security`), `content`, and `is_active` flag
- Only one prompt per type can be active at a time
- Prompts with `internal = 1` are hidden from the prompt selector (used for captcha solvers, etc.)

**User access (`users.prompt_access`):**
- All users get the `general` prompt by default
- Additional prompt types (like `security`) require admin-granted access
- Access is stored as a comma-separated list in the user's `prompt_access` column
- Admin grants/revokes access via the admin dashboard

**Extension flow:**
1. After auth, `syncPromptsFromServer()` calls `GET /api/user/prompts`
2. Server returns only the active, non-internal prompts the user has access to
3. If the user has access to more than one type, a prompt selector dropdown appears in the header
4. Switching prompt type ends the current chat (with confirmation)
5. The selected `promptType` is sent with every `POST /api/chat` request
6. Server validates the user has access, then loads the matching system prompt

### Security Prompt & Scripts Button

When the `security` prompt type is active, the extension enables a penetration testing workflow:

**Setup (admin side):**
1. Create a prompt with `type = 'security'` in admin panel (Prompts section)
2. Write a system prompt that instructs the AI to perform security audits
3. Grant specific users access: set `prompt_access = 'security'` on their user record

**Usage (user side):**
1. Select "Security" from the prompt dropdown — starts a new chat with the security system prompt
2. Ask the AI to audit the current page — it will use CDP/JS auto-execution to probe endpoints, test for SQLi, XSS, CSRF, etc.
3. After the audit, click the **Scripts** button in the header

**Scripts button behavior:**
- Only **visible** when the prompt selector is set to `security`
- Only **enabled** when there is an active security session and the AI is not streaming
- On click: injects a predefined message requesting proof-of-concept extraction scripts for all confirmed vulnerabilities
- The injected prompt explicitly requests 4-space indented code blocks (not fenced) to prevent auto-execution, so the user can review scripts before running them
- Generates three script variants per vulnerability: browser JS, bash/curl, and tool-specific (e.g. sqlmap)

**Data flow:**
```
Admin creates security prompt in DB
  -> Admin grants user security access
    -> User selects Security in dropdown
      -> New chat uses security system prompt
        -> AI audits page via CDP/JS auto-exec loop
          -> User clicks Scripts button
            -> Hardcoded script-gen prompt injected
              -> AI outputs PoC scripts (non-auto-exec)
```

## Session Management

- Each tab gets one active session, tracked by tab ID
- Sessions persist across tab switches — switching tabs switches the visible chat
- Session selector dropdown shows all active sessions (current tab marked with a star)
- Sessions from other tabs are read-only (input disabled, banner shown)
- `clearChat()` ends the session on the server, removes the DOM container, and kills the backend process
- On auth, `loadUserSessions()` restores sessions for all open tabs from the server

## Slash Commands

Type these in the chat input:

| Command | Description |
|---------|-------------|
| `/dom` | Get DOM structure |
| `/styles` | Get computed styles |
| `/errors` | Get console errors |
| `/select <selector>` | Get element details |
| `/highlight <selector>` | Highlight elements on page |
| `/network` | Show captured network requests |
| `/cookies` | Show page cookies |
| `/cdp <method> [params]` | Run raw CDP command |
| `/storage` | Get localStorage/sessionStorage |
| `/performance` | Get performance metrics |
| `/sources` | Get page source URLs |
| `/logs` | Show extension logs |
| `/clear` | End current chat |

## Context Management

- Token usage is estimated client-side and shown in a context meter bar
- When context fills up, the **Compact** button summarizes older messages to free space
- Context limits are per-model (200K tokens for Claude models)

## File Handling

- Upload images/files via the upload button, paste, or drag-and-drop (max 20MB)
- Files are uploaded to the server and can be referenced by the AI via URL
- Session files are accessible via the files drawer (folder icon in the tab indicator)
- Files can be downloaded, attached to chat, or deleted via right-click menu
