// content.js — Claude Web Assistant content script (complete rewrite)

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__claudeWebAssistantInjected) return;
  window.__claudeWebAssistantInjected = true;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let isPanelOpen = false;
  let isStreaming = false;
  let conversationHistory = [];
  let currentStreamText = '';
  let pageEnabled = true;

  // Dragging state — panel
  let isDraggingPanel = false;
  let panelDragOffsetX = 0;
  let panelDragOffsetY = 0;

  // Dragging state — toggle button
  let isDraggingToggle = false;
  let toggleDragOffsetX = 0;
  let toggleDragOffsetY = 0;
  let toggleDragMoved = false;

  // Network log captured via background
  const networkLog = [];

  // ---------------------------------------------------------------------------
  // SVG Icons
  // ---------------------------------------------------------------------------
  const ICONS = {
    claude: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 8.5c0 0-1.5-1-3.5-1s-3.5 1.5-3.5 3.5c0 1.5 1 2.5 2 3l1.5.5c1 .4 1.5 1 1.5 2 0 1.2-1 2-2.5 2s-3-.8-3.5-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    send: `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    clear: `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    back: `<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`,
    error: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    page: `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`,
    highlight: `<svg viewBox="0 0 24 24"><path d="M6 14l3 3v5h6v-5l3-3V9H6v5zm5-12h2v3h-2V2zM3.5 5.88l1.41-1.41 2.12 2.12L5.62 8 3.5 5.88zm13.46.71l2.12-2.12 1.41 1.41L18.38 8l-1.42-1.41z"/></svg>`,
    drag: `<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
    toggle: `<svg viewBox="0 0 24 24"><path d="M12 3c-1.04 0-2 .36-2.77 1L12 6.8V2.04c0-.01 0-.03 0-.04zm0 19c1.04 0 2-.36 2.77-1L12 17.2v4.76c0 .01 0 .03 0 .04z" fill="none"/><path d="M13 2.05v8.95h-2V2.05c.33-.03.66-.05 1-.05s.67.02 1 .05zM12 22c-5.52 0-10-4.48-10-10 0-4.17 2.56-7.75 6.2-9.23v2.16C5.47 6.58 4 9.09 4 12c0 4.41 3.59 8 8 8s8-3.59 8-8c0-2.91-1.47-5.42-3.8-7.02V2.77C19.44 4.25 22 7.83 22 12c0 5.52-4.48 10-10 10z"/></svg>`,
    network: `<svg viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>`
  };

  // ---------------------------------------------------------------------------
  // Utility: escapeHtml
  // ---------------------------------------------------------------------------
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Utility: scrollToBottom
  // ---------------------------------------------------------------------------
  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Welcome HTML (reused by clearChat)
  // ---------------------------------------------------------------------------
  function getWelcomeHTML() {
    return `
      <div class="claude-welcome">
        <div class="claude-welcome-icon">${ICONS.claude}</div>
        <h3>Claude Web Assistant</h3>
        <p>Ask anything — Claude has full access to this page via CDP.</p>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Build the root DOM
  // ---------------------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'claude-web-assistant-root';
  document.body.appendChild(root);

  root.innerHTML = `
    <button id="claude-toggle-btn" title="Claude Web Assistant">
      ${ICONS.claude}
    </button>
    <div id="claude-chat-panel">
      <div class="claude-panel-header" id="claude-panel-header">
        <div class="claude-panel-header-left">
          <div class="claude-panel-logo">${ICONS.claude}</div>
          <select id="claude-model-select" title="Select model">
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-haiku-4-5">Haiku 4.5</option>
          </select>
        </div>
        <div class="claude-panel-header-actions">
          <button class="claude-header-btn" id="claude-clear-btn" title="Clear chat">${ICONS.clear}</button>
          <button class="claude-header-btn" id="claude-close-btn" title="Close">${ICONS.close}</button>
        </div>
      </div>
      <div class="claude-messages" id="claude-messages">
        ${getWelcomeHTML()}
      </div>
      <div class="claude-input-area">
        <div class="claude-input-wrapper">
          <textarea id="claude-chat-input" placeholder="Ask about this page..." rows="1"></textarea>
        </div>
        <button id="claude-send-btn" title="Send">${ICONS.send}</button>
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // Inline styles for the per-page toggle switch (injected once)
  // ---------------------------------------------------------------------------
  const extraStyle = document.createElement('style');
  extraStyle.textContent = `
    #claude-toggle-btn.claude-toggle-disabled {
      opacity: 0.5;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    #claude-toggle-btn.claude-toggle-disabled::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 36px;
      height: 3px;
      background: #ef4444;
      border-radius: 2px;
      transform: translate(-50%, -50%) rotate(-45deg);
    }
    .claude-panel-header {
      cursor: grab;
    }
    .claude-panel-header.claude-dragging {
      cursor: grabbing;
    }
    #claude-model-select {
      background: rgba(124, 58, 237, 0.15);
      color: #c4b5fd;
      border: 1px solid rgba(124, 58, 237, 0.3);
      border-radius: 6px;
      padding: 3px 6px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23a78bfa'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
      padding-right: 18px;
    }
    #claude-model-select:hover {
      border-color: rgba(124, 58, 237, 0.5);
      background-color: rgba(124, 58, 237, 0.25);
    }
    #claude-model-select option {
      background: #1e1f36;
      color: #e2e8f0;
    }
  `;
  root.appendChild(extraStyle);

  // ---------------------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------------------
  const toggleBtn = root.querySelector('#claude-toggle-btn');
  const chatPanel = root.querySelector('#claude-chat-panel');
  const panelHeader = root.querySelector('#claude-panel-header');
  const messagesEl = root.querySelector('#claude-messages');
  const inputEl = root.querySelector('#claude-chat-input');
  const sendBtn = root.querySelector('#claude-send-btn');
  const closeBtn = root.querySelector('#claude-close-btn');
  const clearBtn = root.querySelector('#claude-clear-btn');
  const modelSelect = root.querySelector('#claude-model-select');

  // Load saved model preference
  chrome.storage.sync.get(['model'], (result) => {
    if (result.model && modelSelect) {
      modelSelect.value = result.model;
    }
  });

  // Save model on change and update background.js settings
  modelSelect.addEventListener('change', () => {
    const model = modelSelect.value;
    chrome.storage.sync.set({ model });
    // Clear session so next message uses new model
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' });
  });

  // ---------------------------------------------------------------------------
  // Panel dragging
  // ---------------------------------------------------------------------------
  panelHeader.addEventListener('mousedown', (e) => {
    // Don't drag when clicking buttons, select, or the toggle switch inside the header
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
      return;
    }
    isDraggingPanel = true;
    const rect = chatPanel.getBoundingClientRect();
    panelDragOffsetX = e.clientX - rect.left;
    panelDragOffsetY = e.clientY - rect.top;
    panelHeader.classList.add('claude-dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isDraggingPanel) {
      e.preventDefault();
      let newLeft = e.clientX - panelDragOffsetX;
      let newTop = e.clientY - panelDragOffsetY;

      // Keep within viewport bounds
      const panelW = chatPanel.offsetWidth;
      const panelH = chatPanel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      newLeft = Math.max(0, Math.min(newLeft, vw - panelW));
      newTop = Math.max(0, Math.min(newTop, vh - panelH));

      // Switch to top/left positioning (remove bottom/right defaults)
      chatPanel.style.top = newTop + 'px';
      chatPanel.style.left = newLeft + 'px';
      chatPanel.style.bottom = 'auto';
      chatPanel.style.right = 'auto';
    }

    if (isDraggingToggle) {
      e.preventDefault();
      toggleDragMoved = true;
      let newLeft = e.clientX - toggleDragOffsetX;
      let newTop = e.clientY - toggleDragOffsetY;

      const btnW = toggleBtn.offsetWidth;
      const btnH = toggleBtn.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      newLeft = Math.max(0, Math.min(newLeft, vw - btnW));
      newTop = Math.max(0, Math.min(newTop, vh - btnH));

      toggleBtn.style.position = 'fixed';
      toggleBtn.style.top = newTop + 'px';
      toggleBtn.style.left = newLeft + 'px';
      toggleBtn.style.bottom = 'auto';
      toggleBtn.style.right = 'auto';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingPanel) {
      isDraggingPanel = false;
      panelHeader.classList.remove('claude-dragging');
    }
    if (isDraggingToggle) {
      isDraggingToggle = false;
      // If not moved, treat as click — handled below
    }
  });

  // Prevent text selection during drag
  document.addEventListener('selectstart', (e) => {
    if (isDraggingPanel || isDraggingToggle) {
      e.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------
  // Toggle button dragging + click
  // ---------------------------------------------------------------------------
  toggleBtn.addEventListener('mousedown', (e) => {
    isDraggingToggle = true;
    toggleDragMoved = false;
    const rect = toggleBtn.getBoundingClientRect();
    toggleDragOffsetX = e.clientX - rect.left;
    toggleDragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  toggleBtn.addEventListener('mouseup', (e) => {
    if (!toggleDragMoved) {
      // Treat as click
      if (!pageEnabled) return; // page is disabled, don't open
      togglePanel();
    }
    toggleDragMoved = false;
  });

  toggleBtn.addEventListener('click', (e) => {
    // Prevent the default click handler — we handle it in mouseup
    e.preventDefault();
  });

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------
  closeBtn.addEventListener('click', () => togglePanel(false));
  clearBtn.addEventListener('click', clearChat);

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ---------------------------------------------------------------------------
  // Per-page enable/disable (controlled from popup/extension action only)
  // ---------------------------------------------------------------------------
  function setPageEnabled(enabled) {
    pageEnabled = enabled;

    if (!enabled) {
      togglePanel(false);
      toggleBtn.classList.add('claude-toggle-disabled');
    } else {
      toggleBtn.classList.remove('claude-toggle-disabled');
    }
  }

  // Load page-enabled state on init
  chrome.runtime.sendMessage({
    type: 'GET_PAGE_ENABLED',
    url: window.location.href
  }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.enabled === false) {
      setPageEnabled(false);
    }
  });

  // ---------------------------------------------------------------------------
  // Panel visibility
  // ---------------------------------------------------------------------------
  function togglePanel(forceState) {
    isPanelOpen = forceState !== undefined ? forceState : !isPanelOpen;
    chatPanel.classList.toggle('claude-panel-open', isPanelOpen);
    if (isPanelOpen) {
      inputEl.focus();
      scrollToBottom();
    }
  }

  // ---------------------------------------------------------------------------
  // Clear chat
  // ---------------------------------------------------------------------------
  function clearChat() {
    conversationHistory = [];
    messagesEl.innerHTML = getWelcomeHTML();
    // End the persistent Claude session so next message starts fresh
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }

  // ---------------------------------------------------------------------------
  // Gather page context
  // ---------------------------------------------------------------------------
  function gatherPageContext() {
    let domContext = {};
    let pageData = {};

    if (window.ClaudeDOMInspector) {
      try {
        domContext = window.ClaudeDOMInspector.getPageContext();
      } catch (e) {
        domContext = { error: e.message };
      }
    }

    if (window.ClaudePageDataCollector) {
      try {
        pageData = {
          cookies: window.ClaudePageDataCollector.getCookiesSummary(),
          performance: window.ClaudePageDataCollector.getPerformanceData(),
          network: window.ClaudePageDataCollector.getNetworkInfo(),
          security: window.ClaudePageDataCollector.getSecurityInfo()
        };
      } catch (e) {
        pageData = { error: e.message };
      }
    }

    return Object.assign({}, domContext, { pageData: pageData });
  }

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    // Handle commands
    const commandResult = handleCommand(text);
    if (commandResult === true) {
      inputEl.value = '';
      inputEl.style.height = 'auto';
      return;
    }

    let userMessage = text;
    let extraContext = '';

    if (commandResult && typeof commandResult === 'string') {
      extraContext = commandResult;
    }

    // Clear welcome message on first send
    const welcome = messagesEl.querySelector('.claude-welcome');
    if (welcome) welcome.remove();

    // Add user message to UI
    addMessageToUI('user', text);

    // Gather page context
    const pageContext = gatherPageContext();
    if (extraContext) {
      pageContext.extraContext = extraContext;
    }

    // Build conversation entry
    const fullUserContent = userMessage + (extraContext ? '\n\n[Context: ' + extraContext + ']' : '');
    conversationHistory.push({ role: 'user', content: fullUserContent });

    chrome.runtime.sendMessage({
      type: 'CHAT_MESSAGE',
      userMessage: fullUserContent,
      pageContext: pageContext,
      history: conversationHistory.slice(0, -1)
    });

    isStreaming = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';
  }

  // ---------------------------------------------------------------------------
  // Command handling
  // ---------------------------------------------------------------------------
  function handleCommand(text) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case '/dom': {
        const ctx = window.ClaudeDOMInspector ? window.ClaudeDOMInspector.getPageContext() : {};
        return 'Full page context:\n' + JSON.stringify(ctx, null, 2);
      }

      case '/styles': {
        if (!arg) {
          addSystemMessage('Usage: /styles <css-selector>');
          return true;
        }
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const styles = window.ClaudeDOMInspector.getComputedStylesFor(arg);
        return 'Computed styles for "' + arg + '":\n' + JSON.stringify(styles, null, 2);
      }

      case '/errors': {
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const errors = window.ClaudeDOMInspector.getConsoleErrors();
        if (errors.length === 0) {
          return 'Console errors: None captured.';
        }
        return 'Console errors:\n' + JSON.stringify(errors, null, 2);
      }

      case '/select': {
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const sel = window.ClaudeDOMInspector.getSelectedText();
        if (!sel.text) {
          addSystemMessage('No text selected. Select text on the page first.');
          return true;
        }
        return 'Selected text: "' + sel.text + '"\nContext: ' + sel.context;
      }

      case '/structure': {
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const structure = window.ClaudeDOMInspector.getPageStructure();
        return 'Page DOM structure:\n' + structure;
      }

      case '/highlight': {
        if (!arg) {
          addSystemMessage('Usage: /highlight <css-selector>');
          return true;
        }
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const hlResult = window.ClaudeDOMInspector.highlightElement(arg);
        if (hlResult.error) {
          addSystemMessage('Highlight error: ' + hlResult.error);
        } else {
          addSystemMessage('Highlighted ' + hlResult.highlighted + ' element(s)');
        }
        return true;
      }

      case '/query': {
        if (!arg) {
          addSystemMessage('Usage: /query <javascript-expression>');
          return true;
        }
        if (!window.ClaudeDOMInspector) {
          addSystemMessage('DOM Inspector not available.');
          return true;
        }
        const qResult = window.ClaudeDOMInspector.executeQuery(arg);
        return 'Query result for `' + arg + '`:\n' + JSON.stringify(qResult, null, 2);
      }

      case '/clear': {
        clearChat();
        return true;
      }

      case '/network': {
        // Request network log from background.js
        chrome.runtime.sendMessage({ type: 'GET_NETWORK_LOG' }, (res) => {
          if (chrome.runtime.lastError) {
            addSystemMessage('Could not retrieve network log.');
            return;
          }
          const log = (res && res.log) || [];
          if (log.length === 0) {
            addSystemMessage('Network log: No requests captured.');
          } else {
            // Remove welcome if present
            const w = messagesEl.querySelector('.claude-welcome');
            if (w) w.remove();
            addMessageToUI('user', '/network');
            const contextStr = 'Network log (' + log.length + ' requests):\n' + JSON.stringify(log.slice(0, 50), null, 2);
            conversationHistory.push({ role: 'user', content: '/network\n\n[Context: ' + contextStr + ']' });
            // Send to AI
            chrome.runtime.sendMessage({
              type: 'CHAT_MESSAGE',
              userMessage: '/network\n\n[Context: ' + contextStr + ']',
              pageContext: gatherPageContext(),
              history: conversationHistory.slice(0, -1)
            });
            isStreaming = true;
            sendBtn.disabled = true;
          }
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
        return true;
      }

      case '/cookies': {
        const docCookies = window.ClaudePageDataCollector
          ? window.ClaudePageDataCollector.getCookiesSummary()
          : [];

        // Also request cookies from background.js chrome.cookies API
        chrome.runtime.sendMessage({ type: 'GET_COOKIES', url: window.location.href }, (res) => {
          if (chrome.runtime.lastError) return;
          const chromeCookies = (res && res.cookies) || [];
          const combined = {
            documentCookies: docCookies,
            chromeCookies: chromeCookies
          };
          const contextStr = 'Cookies for this page:\n' + JSON.stringify(combined, null, 2);

          // Remove welcome if present
          const w = messagesEl.querySelector('.claude-welcome');
          if (w) w.remove();
          addMessageToUI('user', '/cookies');
          conversationHistory.push({ role: 'user', content: '/cookies\n\n[Context: ' + contextStr + ']' });
          chrome.runtime.sendMessage({
            type: 'CHAT_MESSAGE',
            userMessage: '/cookies\n\n[Context: ' + contextStr + ']',
            pageContext: gatherPageContext(),
            history: conversationHistory.slice(0, -1)
          });
          isStreaming = true;
          sendBtn.disabled = true;
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
        return true;
      }

      case '/storage': {
        if (!window.ClaudePageDataCollector) {
          addSystemMessage('Page Data Collector not available.');
          return true;
        }
        const storageData = {
          localStorage: window.ClaudePageDataCollector.getLocalStorage(),
          sessionStorage: window.ClaudePageDataCollector.getSessionStorage()
        };
        return 'Storage data:\n' + JSON.stringify(storageData, null, 2);
      }

      case '/performance': {
        if (!window.ClaudePageDataCollector) {
          addSystemMessage('Page Data Collector not available.');
          return true;
        }
        const perfData = window.ClaudePageDataCollector.getPerformanceData();
        return 'Performance data:\n' + JSON.stringify(perfData, null, 2);
      }

      case '/sources': {
        if (!window.ClaudePageDataCollector) {
          addSystemMessage('Page Data Collector not available.');
          return true;
        }
        const sources = window.ClaudePageDataCollector.getPageSources();
        return 'Page sources:\n' + JSON.stringify(sources, null, 2);
      }

      case '/logs': {
        chrome.runtime.sendMessage({ type: 'GET_EXTENSION_LOGS', count: 50 }, (res) => {
          if (chrome.runtime.lastError) {
            addSystemMessage('Could not retrieve logs: ' + chrome.runtime.lastError.message);
            return;
          }
          const logs = (res && res.logs) || 'No logs';
          addSystemMessage('Extension Logs:\n' + logs);
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
        return true;
      }

      case '/cdp': {
        if (!arg) {
          addSystemMessage('Usage: /cdp <method> [params JSON]\nExample: /cdp Runtime.evaluate {"expression": "1+1"}');
          return true;
        }
        const cdpParts = arg.match(/^(\S+)\s*(.*)?$/);
        const cdpMethod = cdpParts ? cdpParts[1] : arg;
        let cdpParams = {};
        if (cdpParts && cdpParts[2]) {
          try {
            cdpParams = JSON.parse(cdpParts[2]);
          } catch (e) {
            addSystemMessage('Invalid JSON params: ' + e.message);
            return true;
          }
        }

        chrome.runtime.sendMessage({
          type: 'CDP_COMMAND',
          method: cdpMethod,
          params: cdpParams
        }, (res) => {
          if (chrome.runtime.lastError) {
            addSystemMessage('CDP error: ' + chrome.runtime.lastError.message);
            return;
          }
          const contextStr = 'CDP ' + cdpMethod + ' result:\n' + JSON.stringify(res, null, 2);

          const w = messagesEl.querySelector('.claude-welcome');
          if (w) w.remove();
          addMessageToUI('user', '/cdp ' + arg);
          conversationHistory.push({ role: 'user', content: '/cdp ' + arg + '\n\n[Context: ' + contextStr + ']' });
          chrome.runtime.sendMessage({
            type: 'CHAT_MESSAGE',
            userMessage: '/cdp ' + arg + '\n\n[Context: ' + contextStr + ']',
            pageContext: gatherPageContext(),
            history: conversationHistory.slice(0, -1)
          });
          isStreaming = true;
          sendBtn.disabled = true;
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
        return true;
      }

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming handlers
  // ---------------------------------------------------------------------------
  function onStreamStart() {
    currentStreamText = '';
    const msgEl = createMessageElement('assistant', '');
    msgEl.id = 'claude-streaming-msg';
    messagesEl.appendChild(msgEl);
    scrollToBottom();
  }

  function onStreamContinue(iteration) {
    // Auto-follow-up: keep the current streaming message and add a thinking indicator
    isStreaming = true;
    sendBtn.disabled = true;
    // Re-use existing streaming msg or create a continuation
    let msgEl = document.getElementById('claude-streaming-msg');
    if (!msgEl) {
      // Previous stream ended — create a new bubble for continuation
      msgEl = createMessageElement('assistant', '');
      msgEl.id = 'claude-streaming-msg';
      messagesEl.appendChild(msgEl);
    }
    // Append a thinking indicator to current text
    currentStreamText += '\n\n';
    const bubble = msgEl.querySelector('.claude-message-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(currentStreamText) +
        '<div class="claude-auto-exec-status">Executing step ' + iteration + '...</div>';
    }
    scrollToBottom();
  }

  function onStreamDelta(text) {
    currentStreamText += text;
    const msgEl = document.getElementById('claude-streaming-msg');
    if (msgEl) {
      const bubble = msgEl.querySelector('.claude-message-bubble');
      if (bubble) {
        bubble.innerHTML = renderMarkdown(currentStreamText);
        attachCodeActions(bubble);
      }
    }
    scrollToBottom();
  }

  function onStreamEnd(fullText, cancelled) {
    isStreaming = false;
    sendBtn.disabled = false;

    const msgEl = document.getElementById('claude-streaming-msg');
    if (msgEl) {
      msgEl.removeAttribute('id');
      if (fullText) {
        const bubble = msgEl.querySelector('.claude-message-bubble');
        if (bubble) {
          bubble.innerHTML = renderMarkdown(fullText);
          attachCodeActions(bubble);
        }
      }
    }

    if (fullText && !cancelled) {
      conversationHistory.push({ role: 'assistant', content: fullText });
    }

    scrollToBottom();
    inputEl.focus();
  }

  function onStreamError(error) {
    isStreaming = false;
    sendBtn.disabled = false;

    const streamingMsg = document.getElementById('claude-streaming-msg');
    if (streamingMsg) streamingMsg.remove();

    const errorEl = document.createElement('div');
    errorEl.className = 'claude-error-msg';
    errorEl.innerHTML = ICONS.error + '<span>' + escapeHtml(error) + '</span>';
    messagesEl.appendChild(errorEl);
    scrollToBottom();
    inputEl.focus();
  }

  // ---------------------------------------------------------------------------
  // Message UI helpers
  // ---------------------------------------------------------------------------
  function addMessageToUI(role, text) {
    const msgEl = createMessageElement(role, text);
    messagesEl.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'claude-system-msg';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function createMessageElement(role, text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'claude-message claude-message-' + role;

    const bubble = document.createElement('div');
    bubble.className = 'claude-message-bubble';

    if (role === 'user') {
      bubble.textContent = text;
    } else {
      if (text) {
        bubble.innerHTML = renderMarkdown(text);
      } else {
        bubble.innerHTML = '<div class="claude-typing"><div class="claude-typing-dot"></div><div class="claude-typing-dot"></div><div class="claude-typing-dot"></div></div>';
      }
    }

    wrapper.appendChild(bubble);

    if (role === 'assistant' && text) {
      attachCodeActions(bubble);
    }

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Code block actions (copy, run query, highlight selectors)
  // ---------------------------------------------------------------------------
  function attachCodeActions(bubble) {
    bubble.querySelectorAll('.claude-code-block').forEach(function (block) {
      // Copy button
      const copyBtn = block.querySelector('.claude-code-copy');
      if (copyBtn && !copyBtn._bound) {
        copyBtn._bound = true;
        copyBtn.addEventListener('click', function () {
          const code = block.querySelector('pre') ? block.querySelector('pre').textContent : '';
          navigator.clipboard.writeText(code).then(function () {
            copyBtn.textContent = 'Copied!';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
          });
        });
      }

      // Run Query button for query code blocks
      const header = block.querySelector('.claude-code-header');
      const lang = header ? (header.textContent || '').trim().toLowerCase() : '';
      if (lang.indexOf('query') !== -1 && !block.querySelector('.claude-execute-query')) {
        const code = block.querySelector('pre') ? block.querySelector('pre').textContent.trim() : '';
        const execBtn = document.createElement('button');
        execBtn.className = 'claude-execute-query';
        execBtn.innerHTML = ICONS.highlight + ' Run Query';
        execBtn.addEventListener('click', function () {
          if (!window.ClaudeDOMInspector) {
            addSystemMessage('DOM Inspector not available.');
            return;
          }
          const result = window.ClaudeDOMInspector.executeQuery(code);
          addSystemMessage('Query result: ' + JSON.stringify(result.result || result.error, null, 2).substring(0, 500));
          scrollToBottom();
        });
        block.appendChild(execBtn);
      }
    });

    // Make inline code selectors clickable for highlighting
    bubble.querySelectorAll('code:not(.claude-code-block code)').forEach(function (codeEl) {
      const codeText = codeEl.textContent;
      if (/^[.#\[\w][\w\-.\[\]#:= >"'*+~,()]+$/.test(codeText) && codeText.length < 100) {
        if (!codeEl._bound) {
          codeEl._bound = true;
          codeEl.style.cursor = 'pointer';
          codeEl.title = 'Click to highlight on page';
          codeEl.addEventListener('click', function () {
            try {
              if (window.ClaudeDOMInspector) {
                window.ClaudeDOMInspector.highlightElement(codeText);
              }
            } catch (e) {
              // Not a valid selector
            }
          });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Markdown renderer
  // ---------------------------------------------------------------------------
  // Languages that indicate "agent" code blocks (collapsed by default)
  const AGENT_LANGS = ['cdp', 'js', 'javascript', 'json', 'query'];

  function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // ── Collapse execution result blocks ──
    // Pattern: \n\n---\n**CDP Result** (`method`):\n```json\n...\n```
    // Pattern: \n\n---\n**JS Result:**\n```\n...\n```
    // Pattern: \n\n---\n**CDP Error** ...\n
    // Pattern: \n\n---\n**JS Error:** ...\n
    html = html.replace(/---\n\*\*(CDP Result|JS Result|CDP Error|JS Error)\*\*[^\n]*\n```(?:\w*)\n([\s\S]*?)```/g, function (match, label, content) {
      const shortLabel = label.replace(' Result', '').replace(' Error', ' Err');
      const icon = label.includes('Error') ? '&#9888;' : '&#9889;';
      const cls = label.includes('Error') ? 'claude-tool-error' : 'claude-tool-ok';
      const preview = content.trim().substring(0, 60).replace(/\n/g, ' ');
      return '<details class="claude-tool-block ' + cls + '"><summary>' +
        '<span class="claude-tool-icon">' + icon + '</span> ' +
        '<span class="claude-tool-label">' + escapeHtml(shortLabel) + '</span>' +
        '<span class="claude-tool-preview">' + escapeHtml(preview) + (content.trim().length > 60 ? '...' : '') + '</span>' +
        '</summary><pre class="claude-tool-content"><code>' + content.trim() + '</code></pre></details>';
    });

    // Also catch plain-text error results (no code block)
    html = html.replace(/---\n\*\*(CDP Error|JS Error)\*\*[^:]*:\s*([^\n]+)/g, function (match, label, errMsg) {
      return '<details class="claude-tool-block claude-tool-error"><summary>' +
        '<span class="claude-tool-icon">&#9888;</span> ' +
        '<span class="claude-tool-label">' + label + '</span>' +
        '<span class="claude-tool-preview">' + escapeHtml(errMsg.substring(0, 60)) + '</span>' +
        '</summary><div class="claude-tool-content">' + escapeHtml(errMsg) + '</div></details>';
    });

    // ── Code blocks: agent langs → collapsed; others → normal ──
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
      const l = (lang || '').toLowerCase();
      const highlighted = highlightSyntax(code.trim(), lang);

      if (AGENT_LANGS.indexOf(l) !== -1) {
        // Collapsed agent code block
        const lines = code.trim().split('\n');
        let summaryText = l.toUpperCase();
        // Try to extract a meaningful label
        if (l === 'cdp') {
          try {
            const parsed = JSON.parse(code.trim());
            if (parsed.method) summaryText = 'CDP: ' + parsed.method;
          } catch (e) { /* not JSON, use default */ }
        } else if (l === 'js' || l === 'javascript') {
          // Use first meaningful line as label
          const firstLine = lines[0].replace(/\/\/\s*/, '').trim();
          summaryText = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
          if (!summaryText) summaryText = 'JavaScript';
        }

        return '<details class="claude-tool-block claude-tool-code"><summary>' +
          '<span class="claude-tool-icon">&#9881;</span> ' +
          '<span class="claude-tool-label">' + escapeHtml(summaryText) + '</span>' +
          '<span class="claude-tool-lines">' + lines.length + ' line' + (lines.length > 1 ? 's' : '') + '</span>' +
          '</summary><div class="claude-code-block"><div class="claude-code-header"><span>' +
          (lang || 'code') +
          '</span><button class="claude-code-copy">Copy</button></div><pre><code>' +
          highlighted + '</code></pre></div></details>';
      }

      // Normal code block (not agent lang)
      return '<div class="claude-code-block"><div class="claude-code-header"><span>' +
        (lang || 'code') +
        '</span><button class="claude-code-copy">Copy</button></div><pre><code>' +
        highlighted + '</code></pre></div>';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs and misplaced tags
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-4]>)/g, '$1');
    html = html.replace(/(<\/h[1-4]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<div class="claude-code-block">)/g, '$1');
    html = html.replace(/(<\/div>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<details)/g, '$1');
    html = html.replace(/(<\/details>)<\/p>/g, '$1');

    return html;
  }

  // ---------------------------------------------------------------------------
  // Syntax highlighter
  // ---------------------------------------------------------------------------
  function highlightSyntax(code, lang) {
    if (!lang) return code;

    const l = lang.toLowerCase();

    if (['js', 'javascript', 'typescript', 'ts', 'query'].indexOf(l) !== -1) {
      code = code.replace(/\/\/.*/g, function (m) { return '<span class="cm">' + m + '</span>'; });
      code = code.replace(/\/\*[\s\S]*?\*\//g, function (m) { return '<span class="cm">' + m + '</span>'; });
      code = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, function (m) { return '<span class="str">' + m + '</span>'; });
      code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
      code = code.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|typeof|instanceof|try|catch|throw|switch|case|break|default|null|undefined|true|false)\b/g, '<span class="kw">$1</span>');
      code = code.replace(/\b(\w+)\s*(?=\()/g, '<span class="fn">$1</span>');
      code = code.replace(/([\=\+\-\*\/\%\!\&\|\<\>\?]+)/g, '<span class="op">$1</span>');
    } else if (['html', 'xml', 'svg'].indexOf(l) !== -1) {
      code = code.replace(/(&lt;\/?)([\w\-]+)/g, '$1<span class="tag">$2</span>');
      code = code.replace(/(\w+)=(&quot;|&apos;)(.*?)\2/g, '<span class="attr">$1</span>=<span class="str">$2$3$2</span>');
    } else if (['css', 'scss', 'less'].indexOf(l) !== -1) {
      code = code.replace(/\/\*[\s\S]*?\*\//g, function (m) { return '<span class="cm">' + m + '</span>'; });
      code = code.replace(/([\.\#\:\[\]][\w\-\=\~\^\$\*\"\]]+)/g, '<span class="tag">$1</span>');
      code = code.replace(/([\w\-]+)\s*:/g, '<span class="attr">$1</span>:');
      code = code.replace(/:(.+?)(;|$)/g, ':<span class="str">$1</span>$2');
    } else if (['python', 'py'].indexOf(l) !== -1) {
      code = code.replace(/#.*/g, function (m) { return '<span class="cm">' + m + '</span>'; });
      code = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, function (m) { return '<span class="str">' + m + '</span>'; });
      code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
      code = code.replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|raise|with|in|not|and|or|is|None|True|False|self|lambda|yield|pass|break|continue)\b/g, '<span class="kw">$1</span>');
      code = code.replace(/\b(\w+)\s*(?=\()/g, '<span class="fn">$1</span>');
    }

    return code;
  }

  // ---------------------------------------------------------------------------
  // Listen for messages from background.js
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener(function (message) {
    switch (message.type) {
      case 'STREAM_START':
        onStreamStart();
        break;
      case 'STREAM_CONTINUE':
        onStreamContinue(message.iteration);
        break;
      case 'STREAM_DELTA':
        onStreamDelta(message.text);
        break;
      case 'STREAM_END':
        onStreamEnd(message.fullText, message.cancelled);
        break;
      case 'STREAM_ERROR':
        onStreamError(message.error);
        break;
      case 'OPEN_PANEL':
        root.style.display = '';
        togglePanel(true);
        break;
      case 'TOGGLE_VISIBILITY':
        setPageEnabled(message.visible);
        root.style.display = message.visible ? '' : 'none';
        break;
      case 'OPEN_SETTINGS':
        // Open the full settings page instead of inline settings
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
        break;
    }
  });

})();
