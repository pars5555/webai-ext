// background.js — Service worker for Claude Web Assistant
// Handles: native messaging to Claude Code CLI, direct API fallback,
//          bidirectional tool calls, CDP, cookies, network log, per-page toggle

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3456';
const NATIVE_HOST_NAME = 'com.claude.web_assistant';
const MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 4096;

// ─── State ────────────────────────────────────────────────────────────────────

const activeStreams = new Map();       // tabId → AbortController or { cancel: fn }
const networkLogs = new Map();         // tabId → Array of request entries
const MAX_NETWORK_LOG = 100;
const attachedTabs = new Set();        // tabIds with debugger attached
let nativePort = null;                 // persistent native messaging port
let pendingRequests = new Map();       // requestId → { resolve, reject, tabId }
const tabSessions = new Map();         // tabId → { sessionId: UUID, messageCount: number }

// ─── Extension Logger ────────────────────────────────────────────────────────
// Collects all logs in-memory so Claude can analyze them without asking the user

const extensionLogs = [];
const MAX_EXT_LOGS = 200;

function xlog(level, category, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const entry = `[${ts}] [${level}] [${category}] ${msg}`;
  extensionLogs.push(entry);
  if (extensionLogs.length > MAX_EXT_LOGS) extensionLogs.splice(0, extensionLogs.length - MAX_EXT_LOGS);
  console.log(`[Claude Ext] ${entry}`);
}

function getRecentLogs(count = 50) {
  return extensionLogs.slice(-count).join('\n');
}

// ─── Service Worker Keep-Alive ────────────────────────────────────────────────
// MV3 service workers die after ~5min of inactivity. Use chrome.alarms to
// keep alive while any session is active.

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // every 24 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Ping native host to keep connection alive
    if (nativePort) {
      try {
        nativePort.postMessage({ type: 'ping' });
      } catch (e) {
        xlog('WARN', 'KEEPALIVE', 'Ping failed:', e.message);
      }
    }
  }
});

// ─── Network Request Logging ──────────────────────────────────────────────────

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;

    if (!networkLogs.has(tabId)) {
      networkLogs.set(tabId, []);
    }

    const log = networkLogs.get(tabId);
    log.push({
      url: details.url,
      method: details.method,
      status: details.statusCode,
      type: details.type,
      timestamp: details.timeStamp
    });

    if (log.length > MAX_NETWORK_LOG) {
      log.splice(0, log.length - MAX_NETWORK_LOG);
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  networkLogs.delete(tabId);
  activeStreams.delete(tabId);
  autoFollowUpCounts.delete(tabId);
  tabSessions.delete(tabId);

  if (attachedTabs.has(tabId)) {
    attachedTabs.delete(tabId);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
  }
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  xlog('DEBUG', 'MSG_ROUTER', 'Received:', message.type, 'from tab:', tabId || 'extension');

  switch (message.type) {
    case 'CHAT_MESSAGE':
      handleChatMessage(message, sender);
      sendResponse({ status: 'streaming_started' });
      return true;

    case 'CANCEL_STREAM':
      handleCancelStream(tabId);
      sendResponse({ status: 'cancelled' });
      return true;

    case 'GET_AUTH_CONFIG':
      handleGetAuthConfig(sendResponse);
      return true;

    case 'SET_AUTH_CONFIG':
      handleSetAuthConfig(message, sendResponse);
      return true;

    case 'CDP_COMMAND':
      handleCdpCommand(message, tabId, sendResponse);
      return true;

    case 'CDP_ATTACH':
      handleCdpAttach(tabId, sendResponse);
      return true;

    case 'CDP_DETACH':
      handleCdpDetach(tabId, sendResponse);
      return true;

    case 'GET_COOKIES':
      handleGetCookies(message, sendResponse);
      return true;

    case 'GET_NETWORK_LOG':
      handleGetNetworkLog(tabId, sendResponse);
      return true;

    case 'GET_PAGE_SOURCES':
      handleGetPageSources(tabId, sendResponse);
      return true;

    case 'GET_PAGE_ENABLED':
      handleGetPageEnabled(message, sendResponse);
      return true;

    case 'SET_PAGE_ENABLED':
      handleSetPageEnabled(message, sendResponse);
      return true;

    case 'OPEN_OPTIONS_PAGE':
      chrome.runtime.openOptionsPage();
      sendResponse({ status: 'ok' });
      return true;

    case 'CHECK_BRIDGE':
      handleCheckBridge(sendResponse);
      return true;

    case 'GET_AUTH_MODE':
      chrome.storage.sync.get(['activeAuthSource'], (result) => {
        sendResponse({ authMode: result.activeAuthSource || 'bridge' });
      });
      return true;

    case 'GET_API_KEY':
      chrome.storage.sync.get(['apiKey'], (result) => {
        sendResponse({ apiKey: result.apiKey || '' });
      });
      return true;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(['model', 'maxTokens', 'autoAttachCdp', 'theme', 'bridgeUrl', 'connectionMode'], (result) => {
        sendResponse({
          model: result.model || MODEL,
          maxTokens: result.maxTokens || MAX_TOKENS,
          autoAttachCdp: result.autoAttachCdp || false,
          theme: result.theme || 'dark',
          bridgeUrl: result.bridgeUrl || DEFAULT_BRIDGE_URL,
          connectionMode: result.connectionMode || 'native'
        });
      });
      return true;

    case 'SET_SETTINGS': {
      const settings = {};
      if (message.model !== undefined) settings.model = message.model;
      if (message.maxTokens !== undefined) settings.maxTokens = message.maxTokens;
      if (message.autoAttachCdp !== undefined) settings.autoAttachCdp = message.autoAttachCdp;
      if (message.theme !== undefined) settings.theme = message.theme;
      if (message.bridgeUrl !== undefined) settings.bridgeUrl = message.bridgeUrl;
      if (message.connectionMode !== undefined) settings.connectionMode = message.connectionMode;
      chrome.storage.sync.set(settings, () => {
        sendResponse({ status: 'saved' });
      });
      return true;
    }

    case 'GET_DISABLED_URLS':
      chrome.storage.local.get(['disabledUrls'], (result) => {
        sendResponse({ disabledUrls: result.disabledUrls || [] });
      });
      return true;

    case 'SET_DISABLED_URLS':
      chrome.storage.local.set({ disabledUrls: message.disabledUrls || [] }, () => {
        sendResponse({ status: 'saved' });
      });
      return true;

    case 'GET_EXTENSION_LOGS':
      sendResponse({ logs: getRecentLogs(message.count || 50) });
      return true;

    case 'CLEAR_SESSION': {
      // Clear session tracking for this tab so next message starts a fresh conversation
      const sid = tabSessions.get(tabId);
      if (sid) {
        xlog('INFO', 'SESSION', 'Clearing session for tab:', tabId, 'session:', sid.sessionId);
        tabSessions.delete(tabId);
      }
      sendResponse({ status: 'ok' });
      return true;
    }

    case 'RESET_ALL':
      disconnectNativeHost();
      chrome.storage.sync.clear(() => {
        chrome.storage.local.clear(() => {
          sendResponse({ status: 'reset' });
        });
      });
      return true;

    default:
      return false;
  }
});

// ─── Auth Config ──────────────────────────────────────────────────────────────

function handleGetAuthConfig(sendResponse) {
  chrome.storage.sync.get(
    ['activeAuthSource', 'apiKey', 'bridgeUrl', 'connectionMode'],
    (result) => {
      sendResponse({
        activeAuthSource: result.activeAuthSource || 'bridge',
        apiKey: result.apiKey || '',
        bridgeUrl: result.bridgeUrl || DEFAULT_BRIDGE_URL,
        connectionMode: result.connectionMode || 'native'
      });
    }
  );
}

function handleSetAuthConfig(message, sendResponse) {
  const config = {};
  if (message.activeAuthSource !== undefined) config.activeAuthSource = message.activeAuthSource;
  if (message.apiKey !== undefined) config.apiKey = message.apiKey;
  if (message.bridgeUrl !== undefined) config.bridgeUrl = message.bridgeUrl;
  if (message.connectionMode !== undefined) config.connectionMode = message.connectionMode;

  chrome.storage.sync.set(config, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
    } else {
      sendResponse({ status: 'saved' });
    }
  });
}

// ─── Native Messaging ─────────────────────────────────────────────────────────

function connectNativeHost() {
  if (nativePort) return nativePort;

  try {
    xlog('INFO', 'NATIVE', 'Connecting to native host:', NATIVE_HOST_NAME);
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      xlog('DEBUG', 'NATIVE', 'Received:', message.type, message.id || '', message.error || '');
      handleNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Native host disconnected';
      xlog('WARN', 'NATIVE', 'Disconnected:', error);
      nativePort = null;

      // Clear all state — the host process is gone
      autoFollowUpCounts.clear();

      // Reject all pending requests
      for (const [, req] of pendingRequests) {
        if (req.tabId) {
          sendToTab(req.tabId, {
            type: 'STREAM_ERROR',
            error: 'Bridge disconnected: ' + error,
          });
        }
      }
      pendingRequests.clear();
    });

    xlog('INFO', 'NATIVE', 'Connected successfully');
    return nativePort;
  } catch (e) {
    xlog('ERROR', 'NATIVE', 'Connection failed:', e.message);
    nativePort = null;
    return null;
  }
}

function disconnectNativeHost() {
  if (nativePort) {
    nativePort.disconnect();
    nativePort = null;
  }
  pendingRequests.clear();
}

async function handleNativeMessage(message) {
  switch (message.type) {
    case 'health_result': {
      const req = pendingRequests.get('health');
      if (req) {
        pendingRequests.delete('health');
        req.resolve(message);
      }
      break;
    }

    case 'stream_delta': {
      const req = pendingRequests.get(message.id);
      if (req) {
        sendToTab(req.tabId, { type: 'STREAM_DELTA', text: message.text });
      }
      break;
    }

    case 'stream_end': {
      const req = pendingRequests.get(message.id);
      if (req) {
        xlog('INFO', 'STREAM', 'Stream ended for', message.id, 'fullText length:', (message.fullText || '').length);

        // Check for CDP/JS commands in the response and auto-execute them
        try {
          const cdpResults = await executeCdpFromResponse(message.fullText, req.tabId);
          if (cdpResults && cdpResults.length > 0) {
            const chatResults = formatCdpResultsForChat(cdpResults);
            xlog('INFO', 'STREAM', 'CDP auto-execution produced', cdpResults.length, 'results');

            // Show results in chat
            sendToTab(req.tabId, { type: 'STREAM_DELTA', text: chatResults });
            sendToTab(req.tabId, { type: 'STREAM_END', fullText: message.fullText + chatResults });

            // Auto-continue: send results back to Claude for next step
            pendingRequests.delete(message.id);
            activeStreams.delete(req.tabId);
            xlog('INFO', 'STREAM', 'Auto-continuing with CDP results...');
            autoFollowUp(req.tabId, cdpResults);
          } else {
            // No CDP blocks — task is done or Claude responded with plain text
            autoFollowUpCounts.delete(req.tabId);
            sendToTab(req.tabId, { type: 'STREAM_END', fullText: message.fullText });
            pendingRequests.delete(message.id);
            activeStreams.delete(req.tabId);
          }
        } catch (e) {
          xlog('ERROR', 'STREAM', 'CDP auto-execution failed:', e.message);
          sendToTab(req.tabId, { type: 'STREAM_END', fullText: message.fullText });
          pendingRequests.delete(message.id);
          activeStreams.delete(req.tabId);
        }
      }
      break;
    }

    case 'stream_error': {
      const req = pendingRequests.get(message.id);
      if (req) {
        xlog('ERROR', 'STREAM', 'Stream error for', message.id, ':', message.error);
        sendToTab(req.tabId, { type: 'STREAM_ERROR', error: message.error });
        pendingRequests.delete(message.id);
        activeStreams.delete(req.tabId);
      }
      break;
    }

    case 'cancelled': {
      // Stream was cancelled successfully
      break;
    }

    case 'pong': {
      // Keep-alive response, nothing to do
      break;
    }

    case 'tool_request': {
      handleToolRequest(message);
      break;
    }

    case 'error': {
      xlog('ERROR', 'NATIVE', 'Host error:', message.error);
      break;
    }
  }
}

// ─── Bidirectional Tool Calls ─────────────────────────────────────────────────
// The native host can request browser tools: DOM, cookies, network, storage, etc.

async function handleToolRequest(message) {
  const { toolId, tool, params, tabId: requestTabId } = message;

  // Determine which tab to run the tool on
  let tabId = requestTabId;
  if (!tabId) {
    // Use the most recently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }

  if (!tabId) {
    sendNativeToolResult(toolId, { error: 'No active tab' });
    return;
  }

  try {
    let result;

    switch (tool) {
      case 'get_dom':
        result = await executeInTab(tabId, () => {
          return document.documentElement.outerHTML.substring(0, 50000);
        });
        break;

      case 'get_cookies': {
        const url = params?.url || (await getTabUrl(tabId));
        const cookies = await chrome.cookies.getAll({ url });
        result = cookies.map(c => ({
          name: c.name, value: c.value, domain: c.domain,
          path: c.path, secure: c.secure, httpOnly: c.httpOnly,
        }));
        break;
      }

      case 'get_network_log':
        result = networkLogs.get(tabId) || [];
        break;

      case 'get_storage':
        result = await executeInTab(tabId, () => {
          const ls = {};
          const ss = {};
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              ls[key] = localStorage.getItem(key)?.substring(0, 500);
            }
          } catch (e) { /* blocked */ }
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              ss[key] = sessionStorage.getItem(key)?.substring(0, 500);
            }
          } catch (e) { /* blocked */ }
          return { localStorage: ls, sessionStorage: ss };
        });
        break;

      case 'get_console_errors':
        result = await executeInTab(tabId, () => {
          return window.__claudeConsoleErrors || [];
        });
        break;

      case 'query_selector':
        result = await executeInTab(tabId, (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          return {
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            textContent: el.textContent?.substring(0, 500),
            outerHTML: el.outerHTML?.substring(0, 2000),
          };
        }, params?.selector);
        break;

      case 'query_selector_all':
        result = await executeInTab(tabId, (selector) => {
          const els = document.querySelectorAll(selector);
          return Array.from(els).slice(0, 50).map(el => ({
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            textContent: el.textContent?.substring(0, 200),
          }));
        }, params?.selector);
        break;

      case 'evaluate_js':
        result = await executeInTab(tabId, (code) => {
          try {
            return eval(code);
          } catch (e) {
            return { error: e.message };
          }
        }, params?.code);
        break;

      case 'get_page_info':
        result = await executeInTab(tabId, () => ({
          url: location.href,
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content || '',
        }));
        break;

      case 'cdp_command': {
        if (!attachedTabs.has(tabId)) {
          await chrome.debugger.attach({ tabId }, '1.3');
          attachedTabs.add(tabId);
        }
        result = await chrome.debugger.sendCommand(
          { tabId },
          params?.method,
          params?.params || {}
        );
        break;
      }

      case 'highlight_element':
        await chrome.tabs.sendMessage(tabId, {
          type: 'HIGHLIGHT_ELEMENT',
          selector: params?.selector,
        });
        result = { highlighted: params?.selector };
        break;

      default:
        result = { error: 'Unknown tool: ' + tool };
    }

    sendNativeToolResult(toolId, { result });
  } catch (e) {
    sendNativeToolResult(toolId, { error: e.message });
  }
}

function sendNativeToolResult(toolId, data) {
  if (nativePort) {
    nativePort.postMessage({
      type: 'tool_result',
      toolId,
      ...data,
    });
  }
}

async function executeInTab(tabId, func, ...args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results[0]?.result;
}

async function getTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return tab.url;
}

// ─── Bridge Health Check ──────────────────────────────────────────────────────

async function handleCheckBridge(sendResponse) {
  const config = await chrome.storage.sync.get(['connectionMode', 'bridgeUrl']);
  const mode = config.connectionMode || 'native';

  if (mode === 'native') {
    // Try native messaging
    try {
      const port = connectNativeHost();
      if (!port) {
        sendResponse({
          status: 'error',
          error: 'Native host not installed. Run: node install-host.js --extension-id YOUR_ID',
          mode: 'native'
        });
        return;
      }

      // Send health check with timeout
      const healthPromise = new Promise((resolve, reject) => {
        pendingRequests.set('health', { resolve, reject, tabId: null });
        port.postMessage({ type: 'health' });
        setTimeout(() => {
          if (pendingRequests.has('health')) {
            pendingRequests.delete('health');
            reject(new Error('Health check timeout'));
          }
        }, 8000);
      });

      const result = await healthPromise;
      sendResponse({
        status: 'ok',
        mode: 'native',
        claude: { ok: result.ok, version: result.version },
        bridge: 'Native messaging connected',
      });
    } catch (e) {
      sendResponse({
        status: 'error',
        error: e.message || 'Native messaging failed',
        mode: 'native'
      });
    }
  } else {
    // HTTP bridge mode
    try {
      const bridgeUrl = config.bridgeUrl || DEFAULT_BRIDGE_URL;
      const response = await fetch(`${bridgeUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        sendResponse({ status: 'error', error: `Bridge returned ${response.status}`, mode: 'http' });
        return;
      }

      const data = await response.json();
      sendResponse({
        status: 'ok',
        mode: 'http',
        bridge: data.bridge || 'Connected',
        claude: data.claude || {},
        bridgeUrl,
      });
    } catch (error) {
      sendResponse({
        status: 'error',
        mode: 'http',
        error: error.name === 'TimeoutError'
          ? 'Bridge server not reachable (timeout)'
          : `Bridge not reachable: ${error.message}`,
      });
    }
  }
}

// ─── Chat Message Handler ─────────────────────────────────────────────────────

function handleCancelStream(tabId) {
  const stream = activeStreams.get(tabId);
  if (!stream) return;

  if (stream.abort) {
    stream.abort(); // AbortController
  } else if (stream.cancel) {
    stream.cancel(); // Native messaging cancel
  }
  activeStreams.delete(tabId);
}

async function handleChatMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  const config = await chrome.storage.sync.get(['activeAuthSource', 'connectionMode']);
  const authMode = config.activeAuthSource || 'bridge';

  if (authMode === 'api_key' || authMode === 'apikey') {
    return handleChatViaApiKey(message, tabId);
  }

  // Bridge mode — try native first, fall back to HTTP
  const mode = config.connectionMode || 'native';
  if (mode === 'native') {
    return handleChatViaNative(message, tabId);
  } else {
    return handleChatViaHttpBridge(message, tabId);
  }
}

// ─── Auto-attach Debugger & Pre-fetch CDP Data ───────────────────────────────

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return true;
  try {
    xlog('INFO', 'CDP', 'Attaching debugger to tab:', tabId);
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    xlog('INFO', 'CDP', 'Debugger attached successfully to tab:', tabId);
    return true;
  } catch (e) {
    xlog('ERROR', 'CDP', 'Could not attach debugger to tab', tabId, ':', e.message);
    return false;
  }
}

async function prefetchCdpData(tabId) {
  const cdpData = {};
  xlog('INFO', 'CDP_PREFETCH', 'Starting prefetch for tab:', tabId);
  const hasDebugger = await ensureDebuggerAttached(tabId);
  if (!hasDebugger) {
    xlog('WARN', 'CDP_PREFETCH', 'No debugger, skipping prefetch');
    return cdpData;
  }

  try {
    // Get performance metrics
    await chrome.debugger.sendCommand({ tabId }, 'Performance.enable', {});
    const metrics = await chrome.debugger.sendCommand({ tabId }, 'Performance.getMetrics', {});
    if (metrics?.metrics) {
      const interesting = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount',
        'RecalcStyleCount', 'Documents', 'Frames', 'JSEventListeners',
        'DomContentLoaded', 'NavigationStart'];
      cdpData.performanceMetrics = {};
      for (const m of metrics.metrics) {
        if (interesting.includes(m.name)) {
          cdpData.performanceMetrics[m.name] = m.value;
        }
      }
    }
  } catch (e) { /* ignore */ }

  try {
    // Get security state
    await chrome.debugger.sendCommand({ tabId }, 'Security.enable', {});
    cdpData.securityInfo = 'Security monitoring enabled';
  } catch (e) { /* ignore */ }

  try {
    // Get full DOM snapshot (compact)
    const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', { depth: -1 });
    if (doc?.root) {
      cdpData.domNodeCount = countNodes(doc.root);
    }
  } catch (e) { /* ignore */ }

  return cdpData;
}

function countNodes(node) {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

// ─── Chat via Native Messaging (One-Shot with Session Persistence) ───────────
// Each message spawns a new `claude -p` process. Conversation continuity is
// maintained via --session-id (first message) and --resume (subsequent messages).
// Claude Code persists history internally so we don't need to resend it.

function generateUUID() {
  // Simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function handleChatViaNative(message, tabId) {
  xlog('INFO', 'CHAT', 'handleChatViaNative called, tabId:', tabId, 'userMessage:', (message.userMessage || '').substring(0, 100));
  resetAutoFollowUp(tabId);

  const port = connectNativeHost();
  if (!port) {
    xlog('ERROR', 'CHAT', 'Native host not connected');
    sendToTab(tabId, {
      type: 'STREAM_ERROR',
      error: 'Native host not connected. Go to Settings to set up the bridge.',
    });
    return;
  }

  sendToTab(tabId, { type: 'STREAM_START' });

  // Pre-fetch rich CDP data from the tab
  xlog('INFO', 'CHAT', 'Pre-fetching CDP data for tab:', tabId);
  const cdpData = await prefetchCdpData(tabId);
  xlog('INFO', 'CHAT', 'CDP pre-fetch done, keys:', Object.keys(cdpData));

  const enrichedContext = { ...message.pageContext, ...cdpData };
  const systemPrompt = buildSystemPrompt(enrichedContext);

  const settings = await chrome.storage.sync.get(['model']);
  const model = settings.model || MODEL;

  // Get or create session tracking for this tab
  let session = tabSessions.get(tabId);
  let isResume = false;
  if (!session) {
    // First message for this tab — create a new session ID
    session = { sessionId: generateUUID(), messageCount: 0, model };
    tabSessions.set(tabId, session);
    xlog('INFO', 'SESSION', 'New session for tab:', tabId, 'sessionId:', session.sessionId);
  } else {
    // Subsequent message — resume existing session
    isResume = true;
    xlog('INFO', 'SESSION', 'Resuming session for tab:', tabId, 'sessionId:', session.sessionId, 'msgCount:', session.messageCount);
  }
  session.messageCount++;

  const requestId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  xlog('INFO', 'CHAT', 'Sending chat:', requestId, 'session:', session.sessionId, 'isResume:', isResume);

  pendingRequests.set(requestId, { tabId });
  activeStreams.set(tabId, {
    cancel: () => {
      port.postMessage({ type: 'cancel' });
      pendingRequests.delete(requestId);
    },
  });

  port.postMessage({
    type: 'chat',
    id: requestId,
    prompt: message.userMessage,
    model,
    systemPrompt, // host.js only uses this on first message (not resume)
    sessionId: session.sessionId,
    isResume,
  });
}

// ─── Auto Follow-Up (CDP execution loop) ─────────────────────────────────────
// After Claude outputs CDP/JS commands and we execute them, send results back
// to Claude via the SAME persistent session. Max 20 iterations (was 5 in one-shot mode).

const autoFollowUpCounts = new Map(); // tabId → iteration count
const MAX_AUTO_FOLLOW_UPS = 20;

function autoFollowUp(tabId, cdpResults) {
  const count = (autoFollowUpCounts.get(tabId) || 0) + 1;
  autoFollowUpCounts.set(tabId, count);

  if (count > MAX_AUTO_FOLLOW_UPS) {
    xlog('WARN', 'AUTO_LOOP', 'Max auto follow-ups reached (', MAX_AUTO_FOLLOW_UPS, '), stopping loop for tab:', tabId);
    autoFollowUpCounts.delete(tabId);
    sendToTab(tabId, { type: 'STREAM_DELTA', text: '\n\n---\n*Auto-execution limit reached. Type a message to continue.*' });
    return;
  }

  xlog('INFO', 'AUTO_LOOP', 'Auto follow-up iteration', count, 'for tab:', tabId);

  const port = connectNativeHost();
  if (!port) {
    xlog('ERROR', 'AUTO_LOOP', 'No native host for auto follow-up');
    autoFollowUpCounts.delete(tabId);
    return;
  }

  const session = tabSessions.get(tabId);
  if (!session) {
    xlog('ERROR', 'AUTO_LOOP', 'No session for tab:', tabId);
    autoFollowUpCounts.delete(tabId);
    return;
  }

  session.messageCount++;

  const requestId = 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  pendingRequests.set(requestId, { tabId });
  activeStreams.set(tabId, {
    cancel: () => {
      port.postMessage({ type: 'cancel' });
      pendingRequests.delete(requestId);
      autoFollowUpCounts.delete(tabId);
    },
  });

  // Send execution results back via --resume (same session)
  const followUpPrompt = formatCdpResultsAsPrompt(cdpResults);
  xlog('INFO', 'AUTO_LOOP', 'Sending follow-up via resume, session:', session.sessionId, 'prompt_len:', followUpPrompt.length);

  // Show thinking indicator (continue in same bubble)
  sendToTab(tabId, { type: 'STREAM_CONTINUE', iteration: count });

  port.postMessage({
    type: 'chat',
    id: requestId,
    prompt: followUpPrompt,
    model: session.model,
    sessionId: session.sessionId,
    isResume: true,
  });
}

// Reset auto follow-up counter when user sends a new message
function resetAutoFollowUp(tabId) {
  autoFollowUpCounts.delete(tabId);
}

// ─── Chat via HTTP Bridge ─────────────────────────────────────────────────────

async function handleChatViaHttpBridge(message, tabId) {
  try {
    const config = await chrome.storage.sync.get(['bridgeUrl', 'model', 'maxTokens']);
    const bridgeUrl = config.bridgeUrl || DEFAULT_BRIDGE_URL;
    const model = config.model || MODEL;
    const maxTokens = config.maxTokens || MAX_TOKENS;

    // Pre-fetch rich CDP data
    const cdpData = await prefetchCdpData(tabId);
    const enrichedContext = { ...message.pageContext, ...cdpData };
    const systemPrompt = buildSystemPrompt(enrichedContext);

    let fullMessage = message.userMessage;
    if (message.history && message.history.length > 0) {
      const recent = message.history.slice(-10);
      let historyContext = 'Previous conversation:\n';
      for (const msg of recent) {
        const role = msg.role === 'user' ? 'Human' : 'Assistant';
        historyContext += `${role}: ${msg.content}\n\n`;
      }
      historyContext += 'Now respond to the following new message from the user:\n\n';
      fullMessage = historyContext + message.userMessage;
    }

    const controller = new AbortController();
    activeStreams.set(tabId, controller);

    sendToTab(tabId, { type: 'STREAM_START' });

    const response = await fetch(`${bridgeUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage, model, maxTokens, systemPrompt }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = `Bridge error ${response.status}`;
      try { errorMessage = (await response.json()).error || errorMessage; } catch (e) { /* */ }
      sendToTab(tabId, { type: 'STREAM_ERROR', error: errorMessage });
      activeStreams.delete(tabId);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let streamEnded = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);
          if (event.type === 'delta') {
            fullResponse += event.text;
            sendToTab(tabId, { type: 'STREAM_DELTA', text: event.text });
          } else if (event.type === 'done' && !streamEnded) {
            sendToTab(tabId, { type: 'STREAM_END', fullText: event.fullText || fullResponse });
            streamEnded = true;
          } else if (event.type === 'error') {
            sendToTab(tabId, { type: 'STREAM_ERROR', error: event.error });
            streamEnded = true;
          }
        } catch (e) { /* skip */ }
      }
    }

    if (!streamEnded) sendToTab(tabId, { type: 'STREAM_END', fullText: fullResponse });
    activeStreams.delete(tabId);

  } catch (error) {
    if (error.name === 'AbortError') {
      sendToTab(tabId, { type: 'STREAM_END', fullText: '', cancelled: true });
    } else {
      let errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        errorMsg = 'Cannot connect to bridge server. Run: node bridge.js';
      }
      sendToTab(tabId, { type: 'STREAM_ERROR', error: errorMsg });
    }
    activeStreams.delete(tabId);
  }
}

// ─── Chat via Direct API Key ──────────────────────────────────────────────────

async function handleChatViaApiKey(message, tabId) {
  try {
    const config = await chrome.storage.sync.get(['apiKey', 'model', 'maxTokens']);
    const apiKey = config.apiKey;
    if (!apiKey) {
      sendToTab(tabId, { type: 'STREAM_ERROR', error: 'API key not set. Open Settings to configure.' });
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    const systemPrompt = buildSystemPrompt(message.pageContext);
    const messages = buildMessages(message.history, message.userMessage);
    const model = config.model || MODEL;
    const maxTokens = config.maxTokens || MAX_TOKENS;

    const controller = new AbortController();
    activeStreams.set(tabId, controller);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `API error ${response.status}`;
      try { errorMessage = JSON.parse(errorBody).error?.message || errorMessage; } catch (e) { /* */ }
      sendToTab(tabId, { type: 'STREAM_ERROR', error: errorMessage });
      activeStreams.delete(tabId);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let streamEnded = false;

    sendToTab(tabId, { type: 'STREAM_START' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta') {
            const text = event.delta?.text || '';
            fullResponse += text;
            sendToTab(tabId, { type: 'STREAM_DELTA', text });
          } else if (event.type === 'message_stop') {
            sendToTab(tabId, { type: 'STREAM_END', fullText: fullResponse });
            streamEnded = true;
          } else if (event.type === 'error') {
            sendToTab(tabId, { type: 'STREAM_ERROR', error: event.error?.message || 'Stream error' });
            streamEnded = true;
          }
        } catch (e) { /* skip */ }
      }
    }

    if (!streamEnded) sendToTab(tabId, { type: 'STREAM_END', fullText: fullResponse });
    activeStreams.delete(tabId);

  } catch (error) {
    if (error.name === 'AbortError') {
      sendToTab(tabId, { type: 'STREAM_END', fullText: '', cancelled: true });
    } else {
      sendToTab(tabId, { type: 'STREAM_ERROR', error: error.message || 'Unknown error' });
    }
    activeStreams.delete(tabId);
  }
}

// ─── Auto-Execute CDP/JS Commands from Claude's Response ─────────────────────

async function executeCdpFromResponse(responseText, tabId) {
  if (!responseText || !tabId) return null;

  const results = [];
  xlog('INFO', 'CDP_EXEC', 'Scanning response for CDP/JS blocks, text length:', responseText.length);

  // Match ```cdp ... ``` blocks
  const cdpRegex = /```cdp\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = cdpRegex.exec(responseText)) !== null) {
    const rawCmd = match[1].trim();
    xlog('INFO', 'CDP_EXEC', 'Found CDP block:', rawCmd.substring(0, 100));
    try {
      const cmd = JSON.parse(rawCmd);
      if (cmd.method) {
        await ensureDebuggerAttached(tabId);
        xlog('INFO', 'CDP_EXEC', 'Executing CDP:', cmd.method, JSON.stringify(cmd.params || {}).substring(0, 200));
        const result = await chrome.debugger.sendCommand({ tabId }, cmd.method, cmd.params || {});
        const resultStr = JSON.stringify(result, null, 2);
        xlog('INFO', 'CDP_EXEC', 'CDP result for', cmd.method, ':', resultStr.substring(0, 200));
        // Truncate screenshot/binary data for display
        let displayResult = resultStr;
        if (cmd.method === 'Page.captureScreenshot' && result?.data) {
          displayResult = '{"data": "(base64 image, ' + result.data.length + ' chars)"}';
        }
        results.push({ type: 'cdp', method: cmd.method, result: displayResult.substring(0, 5000) });
      }
    } catch (e) {
      xlog('ERROR', 'CDP_EXEC', 'CDP error:', e.message, 'for command:', rawCmd.substring(0, 100));
      results.push({ type: 'cdp_error', method: rawCmd.substring(0, 50), error: e.message });
    }
  }

  // Match ```js ... ``` or ```javascript ... ``` blocks — execute via Runtime.evaluate
  const jsRegex = /```(?:js|javascript)\s*\n([\s\S]*?)```/g;
  while ((match = jsRegex.exec(responseText)) !== null) {
    const code = match[1].trim();
    xlog('INFO', 'CDP_EXEC', 'Found JS block:', code.substring(0, 100));
    try {
      await ensureDebuggerAttached(tabId);
      // Replace const/let with var to avoid "Identifier already declared" errors
      // when multiple JS blocks run in the same global scope via Runtime.evaluate.
      // var allows re-declaration; const/let do not in the global scope.
      const safeCode = code.replace(/\b(const|let)\s+/g, 'var ');
      xlog('INFO', 'CDP_EXEC', 'Executing JS (var-safe):', safeCode.substring(0, 200));
      const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: safeCode,
        returnByValue: true,
        awaitPromise: true,
        generatePreview: true,
      });
      xlog('INFO', 'CDP_EXEC', 'JS raw result:', JSON.stringify(result).substring(0, 300));

      let display;
      if (result?.exceptionDetails) {
        display = 'Error: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown error');
        xlog('ERROR', 'CDP_EXEC', 'JS exception:', display);
        results.push({ type: 'js_error', error: display });
      } else {
        const value = result?.result?.value;
        const type = result?.result?.type;
        const subtype = result?.result?.subtype;
        const desc = result?.result?.description;
        const preview = result?.result?.preview;
        if (value !== undefined && value !== null) {
          display = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        } else if (preview) {
          display = JSON.stringify(preview, null, 2);
        } else if (desc) {
          display = desc;
        } else {
          display = `(${type || 'undefined'}${subtype ? ':' + subtype : ''})`;
        }
        results.push({ type: 'js', result: display.substring(0, 5000) });
      }
    } catch (e) {
      xlog('ERROR', 'CDP_EXEC', 'JS execution error:', e.message);
      results.push({ type: 'js_error', error: e.message });
    }
  }

  xlog('INFO', 'CDP_EXEC', 'Total blocks executed:', results.length);
  return results.length > 0 ? results : null;
}

// Format execution results for display in chat
function formatCdpResultsForChat(results) {
  return results.map(r => {
    if (r.type === 'cdp') return `\n\n---\n**CDP Result** (\`${r.method}\`):\n\`\`\`json\n${r.result}\n\`\`\``;
    if (r.type === 'cdp_error') return `\n\n---\n**CDP Error** (\`${r.method}\`): ${r.error}`;
    if (r.type === 'js') return `\n\n---\n**JS Result:**\n\`\`\`\n${r.result}\n\`\`\``;
    if (r.type === 'js_error') return `\n\n---\n**JS Error:** ${r.error}`;
    return '';
  }).join('');
}

// Format execution results as a follow-up prompt for Claude
function formatCdpResultsAsPrompt(results) {
  let prompt = 'Here are the execution results from the commands you provided:\n\n';
  for (const r of results) {
    if (r.type === 'cdp') prompt += `CDP ${r.method} returned:\n${r.result}\n\n`;
    if (r.type === 'cdp_error') prompt += `CDP ${r.method} ERROR: ${r.error}\n\n`;
    if (r.type === 'js') prompt += `JS execution returned:\n${r.result}\n\n`;
    if (r.type === 'js_error') prompt += `JS execution ERROR: ${r.error}\n\n`;
  }
  prompt += 'Based on these results, continue with the task. If the task is complete, summarize what was done. If more steps are needed, provide the next CDP/JS commands to execute.';
  return prompt;
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt(pageContext) {
  let prompt = `You are Claude, an AI assistant embedded in a Chrome extension called "Claude Web Assistant". You have FULL access to the user's browser tab via Chrome DevTools Protocol (CDP) and Chrome Extension APIs.

## Your Capabilities

You are connected to a Chrome Extension (Manifest V3) with these permissions:
- **Chrome Debugger (CDP)**: Full Chrome DevTools Protocol access on the active tab
- **DOM Access**: Read/modify any element, execute JavaScript in page context
- **Network Monitoring**: See all HTTP requests/responses, headers, timing
- **Cookies**: Read/write/delete cookies for any domain
- **Storage**: Access localStorage, sessionStorage, IndexedDB
- **JavaScript Execution**: Run arbitrary JS in the page context
- **Page Resources**: Access all loaded scripts, stylesheets, images
- **Tab Control**: Navigate, reload, capture screenshots
- **Web Navigation**: Monitor navigation events and history

## How to Use CDP Commands

You can execute Chrome DevTools Protocol commands by outputting them in a special code block. The extension will automatically execute these and return results.

Format:
'''cdp
{"method": "DomainName.methodName", "params": {}}
'''

### Common CDP Commands You Can Use:

**DOM & Page:**
- Runtime.evaluate - Execute JavaScript in page context
- DOM.getDocument - Get the DOM tree
- DOM.querySelector / DOM.querySelectorAll - Find elements
- DOM.getOuterHTML - Get element HTML
- DOM.setOuterHTML - Modify element HTML
- DOM.getAttributes - Get element attributes
- DOM.setAttributeValue - Set element attributes
- Page.navigate - Navigate to URL
- Page.reload - Reload page
- Page.captureScreenshot - Take screenshot
- Page.getResourceTree - List all page resources
- Page.getResourceContent - Get resource content

**Network:**
- Network.enable - Start monitoring network
- Network.getResponseBody - Get response body for a request
- Network.getCookies - Get all cookies
- Network.setCookie - Set a cookie
- Network.deleteCookies - Delete cookies
- Network.setExtraHTTPHeaders - Add custom headers
- Network.emulateNetworkConditions - Throttle network

**JavaScript & Console:**
- Runtime.evaluate - Run JS code, get results
- Runtime.callFunctionOn - Call function on specific object
- Runtime.getProperties - Inspect object properties
- Console.enable - Monitor console messages

**Performance & Profiling:**
- Performance.getMetrics - Get performance metrics
- Profiler.start / Profiler.stop - CPU profiling
- HeapProfiler.takeHeapSnapshot - Memory snapshot

**CSS & Rendering:**
- CSS.getComputedStyleForNode - Get computed styles
- CSS.getMatchedStylesForNode - Get CSS rules for element
- Emulation.setDeviceMetricsOverride - Simulate mobile devices
- Emulation.setGeolocationOverride - Fake geolocation

**Storage:**
- DOMStorage.getDOMStorageItems - Get localStorage/sessionStorage
- IndexedDB.requestDatabaseNames - List IndexedDB databases

**Security:**
- Security.enable - Monitor security state

### JavaScript Execution Shorthand:

For quick JS execution, you can also use:
'''js
document.querySelector('selector').textContent
'''

This is equivalent to:
'''cdp
{"method": "Runtime.evaluate", "params": {"expression": "document.querySelector('selector').textContent", "returnByValue": true}}
'''

## Guidelines

- When referencing elements, use CSS selectors so the extension can highlight them
- You can chain multiple CDP commands to accomplish complex tasks
- For DOM manipulation, prefer Runtime.evaluate with JavaScript
- Always explain what you're doing before executing commands
- If a task requires multiple steps, outline the plan first
- Be proactive: if you can answer using the provided page context, do so without needing extra commands

## Current Page Context
`;

  if (pageContext) {
    prompt += `- URL: ${pageContext.url || 'N/A'}
- Title: ${pageContext.title || 'N/A'}
- Description: ${pageContext.description || 'N/A'}
`;

    if (pageContext.headings?.length > 0) {
      prompt += `- Page headings: ${pageContext.headings.slice(0, 20).join(', ')}\n`;
    }
    if (pageContext.metaTags?.length > 0) {
      prompt += `- Meta tags: ${JSON.stringify(pageContext.metaTags.slice(0, 10))}\n`;
    }

    prompt += `- Links count: ${pageContext.linksCount || 0}
- Images count: ${pageContext.imagesCount || 0}
- Forms count: ${pageContext.formsCount || 0}
`;

    if (pageContext.selectedText) {
      prompt += `\n- User's selected text: "${pageContext.selectedText}"\n`;
    }
    if (pageContext.consoleErrors?.length > 0) {
      prompt += `\n- Console errors: ${JSON.stringify(pageContext.consoleErrors.slice(0, 10))}\n`;
    }
    if (pageContext.domStructure) {
      prompt += `\n- DOM structure:\n${pageContext.domStructure}\n`;
    }
    if (pageContext.networkData?.length > 0) {
      prompt += `\n- Recent network requests (last ${pageContext.networkData.length}):\n`;
      for (const req of pageContext.networkData.slice(0, 20)) {
        prompt += `  ${req.method} ${req.status} ${req.type} ${req.url}\n`;
      }
    }
    if (pageContext.cookies?.length > 0) {
      prompt += `\n- Cookies (${pageContext.cookies.length} total):\n`;
      for (const c of pageContext.cookies.slice(0, 15)) {
        prompt += `  ${c.name}=${(c.value || '').substring(0, 50)}${c.value?.length > 50 ? '...' : ''} (domain: ${c.domain})\n`;
      }
    }
    if (pageContext.storageData) {
      if (pageContext.storageData.localStorage) {
        const keys = Object.keys(pageContext.storageData.localStorage);
        prompt += `\n- localStorage (${keys.length} keys): ${keys.slice(0, 20).join(', ')}\n`;
      }
      if (pageContext.storageData.sessionStorage) {
        const keys = Object.keys(pageContext.storageData.sessionStorage);
        prompt += `- sessionStorage (${keys.length} keys): ${keys.slice(0, 20).join(', ')}\n`;
      }
    }
    if (pageContext.performanceMetrics) {
      prompt += `\n- Performance metrics: ${JSON.stringify(pageContext.performanceMetrics)}\n`;
    }
    if (pageContext.securityInfo) {
      prompt += `\n- Security: ${pageContext.securityInfo}\n`;
    }
    if (pageContext.extraContext) {
      prompt += `\n- Additional context:\n${pageContext.extraContext}\n`;
    }
  }

  prompt += `\nBe concise but thorough. Use markdown formatting. When you want to execute a command, use the cdp or js code block format described above.`;

  // Include recent extension logs for self-diagnosis
  const recentLogs = getRecentLogs(30);
  if (recentLogs) {
    prompt += `\n\n## Recent Extension Logs (for debugging)\n\`\`\`\n${recentLogs}\n\`\`\``;
  }

  return prompt;
}

function buildMessages(history, userMessage) {
  const messages = [];
  if (history?.length > 0) {
    for (const msg of history.slice(-20)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// ─── CDP (Chrome DevTools Protocol) ───────────────────────────────────────────

async function handleCdpAttach(tabId, sendResponse) {
  if (!tabId) { sendResponse({ status: 'error', error: 'No tab ID' }); return; }
  if (attachedTabs.has(tabId)) { sendResponse({ status: 'ok', message: 'Already attached' }); return; }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    sendResponse({ status: 'ok' });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message || 'Failed to attach debugger' });
  }
}

async function handleCdpDetach(tabId, sendResponse) {
  if (!tabId) { sendResponse({ status: 'error', error: 'No tab ID' }); return; }
  if (!attachedTabs.has(tabId)) { sendResponse({ status: 'ok', message: 'Not attached' }); return; }
  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    sendResponse({ status: 'ok' });
  } catch (error) {
    attachedTabs.delete(tabId);
    sendResponse({ status: 'error', error: error.message });
  }
}

async function handleCdpCommand(message, tabId, sendResponse) {
  if (!tabId) { sendResponse({ status: 'error', error: 'No tab ID' }); return; }
  if (!message.method) { sendResponse({ status: 'error', error: 'No CDP method' }); return; }
  try {
    if (!attachedTabs.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedTabs.add(tabId);
    }
    const result = await chrome.debugger.sendCommand({ tabId }, message.method, message.params || {});
    sendResponse({ status: 'ok', result });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message || `CDP "${message.method}" failed` });
  }
}

// ─── Cookies / Network / Sources ──────────────────────────────────────────────

async function handleGetCookies(message, sendResponse) {
  if (!message.url) { sendResponse({ status: 'error', error: 'No URL' }); return; }
  try {
    const cookies = await chrome.cookies.getAll({ url: message.url });
    sendResponse({
      status: 'ok',
      cookies: cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
        expirationDate: c.expirationDate,
      })),
    });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message });
  }
}

function handleGetNetworkLog(tabId, sendResponse) {
  if (!tabId) { sendResponse({ status: 'error', error: 'No tab ID' }); return; }
  sendResponse({ status: 'ok', entries: networkLogs.get(tabId) || [] });
}

async function handleGetPageSources(tabId, sendResponse) {
  if (!tabId) { sendResponse({ status: 'error', error: 'No tab ID' }); return; }
  try {
    if (!attachedTabs.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedTabs.add(tabId);
    }
    const tree = await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceTree', {});
    const resources = [];
    if (tree?.frameTree?.resources) {
      for (const resource of tree.frameTree.resources) {
        const entry = { url: resource.url, type: resource.type, mimeType: resource.mimeType };
        if (['Document', 'Stylesheet', 'Script'].includes(resource.type)) {
          try {
            const content = await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceContent', {
              frameId: tree.frameTree.frame.id, url: resource.url,
            });
            if (content?.content) {
              entry.content = content.content.substring(0, 5000);
              entry.truncated = content.content.length > 5000;
            }
          } catch (e) { entry.contentError = e.message; }
        }
        resources.push(entry);
      }
    }
    sendResponse({ status: 'ok', resources });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message });
  }
}

// ─── Per-Page Toggle ──────────────────────────────────────────────────────────

async function handleGetPageEnabled(message, sendResponse) {
  if (!message.url) { sendResponse({ status: 'ok', enabled: true }); return; }
  try {
    const hostname = new URL(message.url).hostname;
    const result = await chrome.storage.local.get(['disabledUrls']);
    sendResponse({ status: 'ok', enabled: !(result.disabledUrls || []).includes(hostname) });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message });
  }
}

async function handleSetPageEnabled(message, sendResponse) {
  if (!message.url) { sendResponse({ status: 'error', error: 'No URL' }); return; }
  try {
    const hostname = new URL(message.url).hostname;
    const result = await chrome.storage.local.get(['disabledUrls']);
    let disabledUrls = result.disabledUrls || [];
    if (message.enabled) {
      disabledUrls = disabledUrls.filter(h => h !== hostname);
    } else if (!disabledUrls.includes(hostname)) {
      disabledUrls.push(hostname);
    }
    await chrome.storage.local.set({ disabledUrls });
    sendResponse({ status: 'ok', enabled: message.enabled });
  } catch (error) {
    sendResponse({ status: 'error', error: error.message });
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
