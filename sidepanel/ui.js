// ui.js — Rendering, utilities, auth UI, button state management
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var ICONS = {
  error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
  highlight: '<svg viewBox="0 0 24 24"><path d="M6 14l3 3v5h6v-5l3-3V9H6v5zm5-12h2v3h-2V2zM3.5 5.88l1.41-1.41 2.12 2.12L5.62 8 3.5 5.88zm13.46.71l2.12-2.12 1.41 1.41L18.38 8l-1.42-1.41z"/></svg>'
};

var SEND_ICON = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
var STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';

var AGENT_LANGS = ['cdp', 'js', 'javascript', 'json', 'query'];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom(force) {
  if (!force && !_autoScroll) return;
  if (force) _autoScroll = true;
  requestAnimationFrame(function () {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      requestAnimationFrame(function () {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  });
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () {
      return true;
    }).catch(function () {
      return fallbackCopy(text);
    });
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  return new Promise(function (resolve, reject) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      document.body.removeChild(textarea);
    }
  });
}

function getWelcomeHTML() {
  return '<div class="wai-welcome">' +
    '<div class="wai-welcome-icon"><img src="../icons/wai-logo-text.svg" width="48" height="48" alt="wAi"></div>' +
    '<h3>AI Web Assistant</h3>' +
    '<p>Ask anything — Claude has full access to this page.</p>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Message UI helpers
// ---------------------------------------------------------------------------
function createMessageElement(role, text) {
  var wrapper = document.createElement('div');
  wrapper.className = 'wai-message wai-message-' + role;

  var label = document.createElement('div');
  label.className = 'wai-message-label';
  label.textContent = role === 'user' ? 'You' : 'AI';
  wrapper.appendChild(label);

  var bubble = document.createElement('div');
  bubble.className = 'wai-message-bubble';

  if (role === 'user') {
    bubble.textContent = text;
  } else {
    if (text) {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.innerHTML = '<div class="wai-typing"><div class="wai-typing-dot"></div><div class="wai-typing-dot"></div><div class="wai-typing-dot"></div></div>';
    }
  }

  wrapper.appendChild(bubble);

  var timeEl = document.createElement('div');
  timeEl.className = 'wai-message-time';
  var now = new Date();
  timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrapper.appendChild(timeEl);

  if (role === 'assistant') {
    var actions = document.createElement('div');
    actions.className = 'wai-message-actions';
    var copyMsgBtn = document.createElement('button');
    copyMsgBtn.className = 'wai-msg-copy-btn';
    copyMsgBtn.title = 'Copy response';
    copyMsgBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    copyMsgBtn.addEventListener('click', function () {
      var rawText = bubble.innerText || bubble.textContent || '';
      copyToClipboard(rawText).then(function () {
        copyMsgBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        setTimeout(function () {
          copyMsgBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
        }, 1500);
      });
    });
    actions.appendChild(copyMsgBtn);
    wrapper.appendChild(actions);

    if (text) attachCodeActions(bubble);
  }

  return wrapper;
}

function attachCodeActions(bubble) {
  bubble.querySelectorAll('.wai-code-block').forEach(function (block) {
    var copyBtn = block.querySelector('.wai-code-copy');
    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener('click', function () {
        var code = block.querySelector('pre') ? block.querySelector('pre').textContent : '';
        copyToClipboard(code).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
        }).catch(function () {
          copyBtn.textContent = 'Failed';
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
        });
      });
    }

    var header = block.querySelector('.wai-code-header');
    var lang = header ? (header.textContent || '').trim().toLowerCase() : '';
    if (lang.indexOf('query') !== -1 && !block.querySelector('.wai-execute-query')) {
      var code = block.querySelector('pre') ? block.querySelector('pre').textContent.trim() : '';
      var execBtn = document.createElement('button');
      execBtn.className = 'wai-execute-query';
      execBtn.innerHTML = ICONS.highlight + ' Run Query';
      execBtn.addEventListener('click', async function () {
        var tabId = await getActiveTabId();
        if (!tabId) return;
        var result = await requestCommandData(tabId, '/query', code);
        addSystemMessage('Query result: ' + JSON.stringify(result.result || result.error, null, 2).substring(0, 500));
        scrollToBottom();
      });
      block.appendChild(execBtn);
    }
  });

  bubble.querySelectorAll('code:not(.wai-code-block code)').forEach(function (codeEl) {
    var codeText = codeEl.textContent;
    if (/^[.#\[\w][\w\-.\[\]#:= >"'*+~,()]+$/.test(codeText) && codeText.length < 100) {
      if (!codeEl._bound) {
        codeEl._bound = true;
        codeEl.style.cursor = 'pointer';
        codeEl.title = 'Click to highlight on page';
        codeEl.addEventListener('click', async function () {
          var tabId = await getActiveTabId();
          if (!tabId) return;
          await requestCommandData(tabId, '/highlight', codeText);
        });
      }
    }
  });
}

function addMessageToUI(role, text) {
  var msgEl = createMessageElement(role, text);
  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

function addSystemMessage(text) {
  addSystemMessageToContainer(messagesEl, text);
}

function addCaptchaSystemMessage(html, targetSid) {
  if (targetSid && targetSid !== activeSessionId) return;
  var container = targetSid ? getSessionContainer(targetSid) : messagesEl;
  var el = document.createElement('div');
  el.className = 'wai-system-msg wai-captcha-msg';
  el.innerHTML = html;
  container.appendChild(el);
  if (targetSid === activeSessionId) scrollToBottom();
}

function addSystemMessageToContainer(container, text) {
  var el = document.createElement('div');
  el.className = 'wai-system-msg';
  el.textContent = text;
  container.appendChild(el);
  if (container === messagesEl) scrollToBottom();
}

// ---------------------------------------------------------------------------
// Attachments rendering
// ---------------------------------------------------------------------------
function renderAttachments() {
  if (pendingAttachments.length === 0) {
    attachmentsEl.style.display = 'none';
    return;
  }

  attachmentsEl.style.display = 'flex';
  attachmentsEl.innerHTML = '';

  pendingAttachments.forEach(function (att, idx) {
    var item = document.createElement('div');
    item.className = 'wai-attachment-item';

    if (att.isImage) {
      var img = document.createElement('img');
      img.src = att.dataUrl;
      img.alt = att.name;
      item.appendChild(img);
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'wai-attachment-name';
    nameEl.textContent = att.name;
    nameEl.title = att.name;
    item.appendChild(nameEl);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'wai-attachment-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', function () {
      pendingAttachments.splice(idx, 1);
      renderAttachments();
    });
    item.appendChild(removeBtn);

    attachmentsEl.appendChild(item);
  });
}

function appendAttachmentThumbs(bubble, atts) {
  if (!bubble || !atts || atts.length === 0) return;
  var imgRow = document.createElement('div');
  imgRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;';
  for (var i = 0; i < atts.length; i++) {
    var att = atts[i];
    if (att.isImage && att.dataUrl) {
      var img = document.createElement('img');
      img.src = att.dataUrl;
      img.style.cssText = 'max-width:120px;max-height:80px;border-radius:6px;object-fit:cover;';
      imgRow.appendChild(img);
    } else {
      var tag = document.createElement('span');
      tag.style.cssText = 'font-size:10px;background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;';
      tag.textContent = att.name || 'file';
      imgRow.appendChild(tag);
    }
  }
  bubble.appendChild(imgRow);
}

// ---------------------------------------------------------------------------
// Context meter
// ---------------------------------------------------------------------------
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function getContextLimit() {
  var model = modelSelect ? modelSelect.value : 'claude-opus-4-6';
  return MODEL_CONTEXT_LIMITS[model] || 200000;
}

function updateContextMeter() {
  var totalTokens = 0;
  for (var i = 0; i < conversationHistory.length; i++) {
    var msg = conversationHistory[i];
    if (typeof msg.content === 'string') {
      totalTokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (var j = 0; j < msg.content.length; j++) {
        var part = msg.content[j];
        if (part.type === 'text') totalTokens += estimateTokens(part.text);
        else if (part.type === 'image') totalTokens += 1600;
      }
    }
  }

  var limit = getContextLimit();
  var usedPct = Math.min((totalTokens / limit) * 100, 100);
  var remainPct = Math.max(100 - usedPct, 0);

  if (contextFill) {
    contextFill.style.width = usedPct + '%';
    contextFill.classList.remove('warn', 'critical');
    if (remainPct <= 10) contextFill.classList.add('critical');
    else if (remainPct <= 30) contextFill.classList.add('warn');
  }

  if (contextLabel) {
    contextLabel.textContent = Math.round(remainPct) + '% remaining';
  }

  if (compactBtn) {
    compactBtn.disabled = conversationHistory.length < 4;
  }
}

// ---------------------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------------------
function showAuthOverlay() {
  if (authOverlay) authOverlay.style.display = 'flex';
  hideAuthError();
  hideAuthSuccess();
  authSubtitle.textContent = 'Sign in to start chatting';
  if (userBadge) userBadge.style.display = 'none';
}

function showChatUI() {
  if (authOverlay) authOverlay.style.display = 'none';
  updateUserBadge();
  // Fetch model list first, then sync the user's saved choice (needs populated options)
  loadModelsFromServer().then(function () {
    syncModelFromServer();
  });
  pingServer();
  syncPromptsFromServer().then(function () {
    return loadUserSessions();
  }).then(function () {
    var sessionForTab = findSessionByTabId(currentTabId);
    if (sessionForTab && !activeSessionId) {
      switchToSession(sessionForTab);
    }
  });
}

function updateUserBadge() {
  if (!userBadge) return;
  chrome.storage.sync.get(['devMode'], function (result) {
    if (result.devMode) {
      userBadge.style.display = 'none';
      return;
    }
    if (authState.isAuthenticated) {
      userBadge.style.display = 'flex';
      if (authState.user) {
        var displayName = authState.user.displayName || (authState.user.email ? authState.user.email.split('@')[0] : 'U');
        var avatarEl = document.getElementById('wai-user-avatar');
        if (avatarEl) {
          if (authState.user.avatarUrl) {
            avatarEl.innerHTML = '<img src="' + authState.user.avatarUrl + '" alt="">';
          } else {
            avatarEl.textContent = displayName.charAt(0).toUpperCase();
          }
        }
        userBadgeText.textContent = '';
        fetchBalance();
      } else {
        userBadgeText.textContent = 'Signed in';
      }
    } else {
      userBadge.style.display = 'none';
    }
  });
}

function fetchBalance() {
  if (!authState.accessToken) return;
  fetch(SERVER_URL + '/api/billing/balance', {
    headers: { 'Authorization': 'Bearer ' + authState.accessToken }
  }).then(function (res) {
    if (res.ok) return res.json();
    return null;
  }).then(function (data) {
    if (data) {
      var balance = '$' + (data.balanceUsd || 0).toFixed(2);
      if (userBadgeText) userBadgeText.textContent = balance;
    }
  }).catch(function () { /* silent */ });
}

function handleTopUp() {
  showPrompt('Enter amount in USD to add (min $25):', '25').then(function (amount) {
    if (!amount) return;
    amount = parseFloat(amount);
    if (isNaN(amount) || amount < 25 || amount > 1000) { showAlert('Amount must be between $25 and $1000'); return; }
    fetch(SERVER_URL + '/api/billing/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authState.accessToken },
      body: JSON.stringify({ amountUsd: amount }),
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank');
      } else {
        showAlert(data.error || 'Failed to create payment');
      }
    }).catch(function (e) {
      showAlert('Payment error: ' + e.message);
    });
  });
}

function showAuthError(msg) {
  if (authError) {
    authError.textContent = msg;
    authError.style.display = 'block';
  }
  if (authSuccess) authSuccess.style.display = 'none';
}

function hideAuthError() {
  if (authError) authError.style.display = 'none';
}

function hideAuthSuccess() {
  if (authSuccess) authSuccess.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Button state management
// ---------------------------------------------------------------------------
function updateSendButton() {
  if (isStreaming) {
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.title = 'Stop response';
    sendBtn.classList.add('stop-mode');
  } else {
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.title = 'Send';
    sendBtn.classList.remove('stop-mode');
  }
  sendBtn.disabled = false;
  updateScriptsButton();
  updateExportButton();
  updateFilesButton();
  if (sessionSelect) sessionSelect.style.display = sessionSelect.options.length > 0 ? '' : 'none';
  if (clearBtn) clearBtn.style.display = 'flex';
}

function updateScriptsButton() {
  if (!scriptsBtn) return;
  var isSecurityPrompt = promptSelect && promptSelect.value === 'security';
  var hasActiveSession = activeSessionId && sessions.has(activeSessionId);
  var sessionIsSecuirty = hasActiveSession && sessions.get(activeSessionId).promptType === 'security';
  scriptsBtn.style.display = isSecurityPrompt ? '' : 'none';
  scriptsBtn.disabled = !(hasActiveSession && sessionIsSecuirty && !isStreaming);
  scriptsBtn.style.opacity = scriptsBtn.disabled ? '0.4' : '1';
}

function updateExportButton() {
  if (!exportMenuItem) return;
  exportMenuItem.style.display = activeSessionId ? '' : 'none';
}

function updateFilesButton() {
  var btn = document.getElementById('wai-files-btn');
  if (!btn) return;
  btn.style.display = activeSessionId ? 'flex' : 'none';
  var drawer = document.getElementById('wai-files-drawer');
  if (drawer) drawer.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function sanitizeSensitiveData(text) {
  if (!text) return text;
  text = text.replace(/sshpass\s+-p\s+\S+\s+ssh[^\n"`)]*(?=[\n"`)|\s])/g, '[sandbox command]');
  text = text.replace(/sshpass\s+-p\s+\S+/g, '[sandbox]');
  text = text.replace(/ssh\s+(?:-o\s+\S+\s+)*\w+@\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\s+-p\s+\d+)?/g, '[sandbox ssh]');
  text = text.replace(/password:\s*sandbox/gi, 'password: [hidden]');
  return text;
}

function renderMarkdown(text) {
  if (!text) return '';
  text = sanitizeSensitiveData(text);

  var html = escapeHtml(text);

  html = html.replace(/---\n\*\*(CDP Result|JS Result|CDP Error|JS Error)\*\*[^\n]*\n```(?:\w*)\n([\s\S]*?)```/g, function (match, label, content) {
    var shortLabel = label.replace(' Result', '').replace(' Error', ' Err');
    var icon = label.includes('Error') ? '&#9888;' : '&#9889;';
    var cls = label.includes('Error') ? 'wai-tool-error' : 'wai-tool-ok';
    var preview = content.trim().substring(0, 60).replace(/\n/g, ' ');
    return '<details class="wai-tool-block ' + cls + '"><summary>' +
      '<span class="wai-tool-icon">' + icon + '</span> ' +
      '<span class="wai-tool-label">' + escapeHtml(shortLabel) + '</span>' +
      '<span class="wai-tool-preview">' + escapeHtml(preview) + (content.trim().length > 60 ? '...' : '') + '</span>' +
      '</summary><pre class="wai-tool-content"><code>' + content.trim() + '</code></pre></details>';
  });

  html = html.replace(/---\n\*\*(CDP Error|JS Error)\*\*[^:]*:\s*([^\n]+)/g, function (match, label, errMsg) {
    return '<details class="wai-tool-block wai-tool-error"><summary>' +
      '<span class="wai-tool-icon">&#9888;</span> ' +
      '<span class="wai-tool-label">' + label + '</span>' +
      '<span class="wai-tool-preview">' + escapeHtml(errMsg.substring(0, 60)) + '</span>' +
      '</summary><div class="wai-tool-content">' + escapeHtml(errMsg) + '</div></details>';
  });

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
    var l = (lang || '').toLowerCase();
    var highlighted = highlightSyntax(code.trim(), lang);

    if (AGENT_LANGS.indexOf(l) !== -1) {
      var lines = code.trim().split('\n');
      var summaryText = l.toUpperCase();
      if (l === 'cdp') {
        try {
          var parsed = JSON.parse(code.trim());
          if (parsed.method) summaryText = 'CDP: ' + parsed.method;
        } catch (e) { /* not JSON */ }
      } else if (l === 'js' || l === 'javascript') {
        var firstLine = lines[0].replace(/\/\/\s*/, '').trim();
        summaryText = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
        if (!summaryText) summaryText = 'JavaScript';
      }

      return '<details class="wai-tool-block wai-tool-code"><summary>' +
        '<span class="wai-tool-icon">&#9881;</span> ' +
        '<span class="wai-tool-label">' + escapeHtml(summaryText) + '</span>' +
        '<span class="wai-tool-lines">' + lines.length + ' line' + (lines.length > 1 ? 's' : '') + '</span>' +
        '</summary><div class="wai-code-block"><div class="wai-code-header"><span>' +
        (lang || 'code') +
        '</span><button class="wai-code-copy">Copy</button></div><pre><code>' +
        highlighted + '</code></pre></div></details>';
    }

    return '<div class="wai-code-block"><div class="wai-code-header"><span>' +
      (lang || 'code') +
      '</span><button class="wai-code-copy">Copy</button></div><pre><code>' +
      highlighted + '</code></pre></div>';
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-4]>)/g, '$1');
  html = html.replace(/(<\/h[1-4]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<div class="wai-code-block">)/g, '$1');
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

  var l = lang.toLowerCase();

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
