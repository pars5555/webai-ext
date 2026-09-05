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
  var model = modelSelect ? modelSelect.value : 'claude-opus-5';
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
  // Banners and the deposit panel belong to the account that just went away.
  clearAnnouncements();
  closeTopUpOverlay();
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
  if (typeof openUserEventStream === 'function') openUserEventStream();
  // The event stream only covers announcements published while the panel is
  // open; this is what actually delivers the rest.
  fetchAnnouncements();
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

// Format a USD amount for display.
//
// This used to be a bare .toFixed(2). A PCN deposit can credit a fraction of a
// cent, so the badge read "$0.00" moments after someone sent real coin -- which
// reads as theft. Show more precision while the number is small, and never
// round a non-zero balance down to nothing.
function formatUsd(value) {
  var n = Number(value);
  if (!isFinite(n)) n = 0;
  var sign = n < 0 ? '-' : '';
  var abs = Math.abs(n);
  if (abs === 0) return '$0.00';
  if (abs < 0.0001) {
    // Smaller than four decimals can show: give the real figure rather than a
    // rounded-off zero. Trailing zeros are trimmed so it stays readable.
    var tiny = abs.toFixed(8).replace(/0+$/, '');
    return /^0\.0*$/.test(tiny) ? sign + '<$0.00000001' : sign + '$' + tiny;
  }
  if (abs < 1) return sign + '$' + abs.toFixed(4);
  return sign + '$' + abs.toFixed(2);
}

function fetchBalance() {
  if (!authState.accessToken) return;
  authedFetch(SERVER_URL + '/api/billing/balance', {}).then(function (res) {
    if (res.ok) return res.json();
    return null;
  }).then(function (data) {
    if (data) {
      var balance = formatUsd(data.balanceUsd || 0);
      if (userBadgeText) userBadgeText.textContent = balance;
    }
  }).catch(function () { /* silent */ });
}

// ---------------------------------------------------------------------------
// Top up — method chooser overlay
// ---------------------------------------------------------------------------
var PCN_POLL_MS = 30000;
var PCN_DECIMALS = 8;              // 1 PCN = 100000000 satoshis
var PCN_ZERO = '0.00000000';
var _pcnPollTimer = null;
var _pcnState = null;

function handleTopUp() {
  openTopUpOverlay();
}

// The original one-click flow, unchanged: prompt for USD, open a NOWPayments
// invoice. Reached from the "Card & crypto checkout" card.
function handleNowPaymentsTopUp() {
  showPrompt('Enter amount in USD to add (min $25):', '25').then(function (amount) {
    if (!amount) return;
    amount = parseFloat(amount);
    if (isNaN(amount) || amount < 25 || amount > 1000) { showAlert('Amount must be between $25 and $1000'); return; }
    authedFetch(SERVER_URL + '/api/billing/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsd: amount }),
    }).then(function (res) {
      // Read the body even on failure -- the API puts the reason in .error.
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, data: data };
      });
    }).then(function (r) {
      if (r.ok && r.data.invoiceUrl) {
        window.open(r.data.invoiceUrl, '_blank');
        return;
      }
      showAlert(friendlyError(r.data.error, 'Failed to create payment'));
    }).catch(function (e) {
      showAlert('Payment error: ' + e.message);
    });
  });
}

function topUpOverlayEl() {
  return document.getElementById('wai-topup-overlay');
}

function isTopUpOverlayOpen() {
  var overlay = topUpOverlayEl();
  return !!(overlay && overlay.style.display !== 'none');
}

function openTopUpOverlay() {
  var overlay = topUpOverlayEl();
  // No markup (older panel HTML) -- fall back to the plain checkout flow.
  if (!overlay) { handleNowPaymentsTopUp(); return; }
  showTopUpMethods();
  overlay.style.display = 'flex';
  loadPcoinMethod();
}

// Every exit from the overlay goes through here, because the deposit poll must
// not outlive it: a side panel can stay open for hours and a leaked 30s
// interval would keep hitting the API forever.
function closeTopUpOverlay() {
  stopPcnPoll();
  var overlay = topUpOverlayEl();
  if (overlay) overlay.style.display = 'none';
}

function showTopUpMethods() {
  stopPcnPoll();
  var methods = document.getElementById('wai-topup-methods');
  var panel = document.getElementById('wai-pcn-panel');
  var title = document.getElementById('wai-topup-title');
  if (methods) methods.style.display = '';
  if (panel) { panel.style.display = 'none'; panel.textContent = ''; }
  if (title) title.textContent = 'Add funds';
}

// The PCN card only exists when the server says the rail is live. "disabled"
// and "unconfigured" are indistinguishable from "no such feature" to a user,
// so in those cases the overlay shows exactly what it shows today.
function loadPcoinMethod() {
  var pcnBtn = document.getElementById('wai-topup-method-pcn');
  var note = document.getElementById('wai-topup-methods-note');
  if (pcnBtn) pcnBtn.style.display = 'none';
  if (note) { note.textContent = 'Checking available methods…'; note.style.display = ''; }
  if (!authState.accessToken) { if (note) note.style.display = 'none'; return; }

  authedFetch(SERVER_URL + '/api/billing/pcoin', {}).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (note) note.style.display = 'none';
    if (!data || !data.enabled) return;
    var status = String(data.addressStatus || '');
    if (status !== 'unclaimed' && status !== 'ok' && status !== 'pool_empty') return;
    _pcnState = data;
    if (pcnBtn) pcnBtn.style.display = '';
  }).catch(function () {
    if (note) note.style.display = 'none';
  });
}

function showPcnPanel() {
  var methods = document.getElementById('wai-topup-methods');
  var panel = document.getElementById('wai-pcn-panel');
  var title = document.getElementById('wai-topup-title');
  if (methods) methods.style.display = 'none';
  if (panel) panel.style.display = '';
  if (title) title.textContent = 'PCoin (PCN) deposit';
  renderPcnPanel(_pcnState);
  startPcnPoll();
}

// ---------------------------------------------------------------------------
// PCoin helpers
// ---------------------------------------------------------------------------
function pcnEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeHttpUrl(url) {
  var s = String(url == null ? '' : url).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

// The QR arrives as a data: URI from the server. Only ever hand an <img> a
// data:image/... value -- anything else is not a picture and has no business
// in a src attribute.
function safeImageDataUri(uri) {
  var s = String(uri == null ? '' : uri).trim();
  return /^data:image\/(svg\+xml|png|jpeg|gif|webp)[;,]/i.test(s) ? s : null;
}

// null must fall through to the default, not to Number(null) === 0 -- a
// missing minConf rendering as "0 confirmations" would be a lie.
function numberOr(value, fallback) {
  if (value == null || value === '') return fallback;
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

// Satoshis are integers and 1e-8 has no exact binary float representation, so
// the conversion is done by moving the decimal point in a string. Never parse
// an amount of money into a float.
function formatPcnFromSat(sat) {
  var s = String(sat == null ? '' : sat).trim();
  var sign = '';
  if (s.charAt(0) === '-') { sign = '-'; s = s.slice(1); }
  if (!/^[0-9]+$/.test(s)) return null;
  while (s.length <= PCN_DECIMALS) s = '0' + s;
  var whole = s.slice(0, s.length - PCN_DECIMALS).replace(/^0+(?=[0-9])/, '');
  return sign + whole + '.' + s.slice(s.length - PCN_DECIMALS);
}

// Pad/trim an already-decimal string to exactly 8 places, again without floats.
function padPcnString(raw) {
  var s = String(raw == null ? '' : raw).trim();
  var sign = '';
  if (s.charAt(0) === '-') { sign = '-'; s = s.slice(1); }
  if (!/^[0-9]*(\.[0-9]*)?$/.test(s) || s === '' || s === '.') return null;
  var parts = s.split('.');
  var whole = (parts[0] || '').replace(/^0+(?=[0-9])/, '') || '0';
  var frac = (parts[1] || '').slice(0, PCN_DECIMALS);
  while (frac.length < PCN_DECIMALS) frac += '0';
  return sign + whole + '.' + frac;
}

// amountSat is the authoritative integer; .pcn is the server's rendering of it.
function depositPcn(dep) {
  var fromSat = formatPcnFromSat(dep && dep.amountSat);
  if (fromSat) return fromSat;
  var fromString = padPcnString(dep && dep.pcn);
  return fromString || PCN_ZERO;
}

// Timestamps are unspecified in the contract -- accept ISO strings as well as
// epoch seconds and epoch milliseconds.
function parseServerDate(value) {
  if (value == null || value === '') return null;
  var d;
  if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
    var n = Number(value);
    d = new Date(n < 100000000000 ? n * 1000 : n);
  } else {
    d = new Date(String(value));
  }
  return isNaN(d.getTime()) ? null : d;
}

function formatDepositTime(dep) {
  var d = parseServerDate(dep && dep.firstSeenAt) || parseServerDate(dep && dep.creditedAt);
  if (!d) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Blocks average ~10 minutes and the credit gate is 6 confirmations, so this
// says "about an hour" with the server's real numbers rather than a guess.
function describeWait(confs, blockMinutes) {
  var mins = confs * blockMinutes;
  if (!isFinite(mins) || mins <= 0) return 'about an hour';
  if (mins < 45) return 'about ' + Math.round(mins) + ' minutes';
  if (mins < 90) return 'about an hour';
  return 'about ' + Math.round(mins / 60) + ' hours';
}

// asOfSeconds is either the age of the quote or the moment it was taken; a
// value big enough to be a unix timestamp is treated as one.
function rateAgeSuffix(asOfSeconds) {
  var n = Number(asOfSeconds);
  if (!isFinite(n) || n <= 0) return '';
  var age = n > 1000000000 ? Math.max(0, Math.floor(Date.now() / 1000) - n) : n;
  if (age < 90) return ' (just now)';
  if (age < 5400) return ' (' + Math.round(age / 60) + ' min ago)';
  return ' (' + Math.round(age / 3600) + ' h ago)';
}

// ---------------------------------------------------------------------------
// PCoin panel rendering
// ---------------------------------------------------------------------------
function renderPcnPanel(state) {
  var panel = document.getElementById('wai-pcn-panel');
  if (!panel) return;
  panel.textContent = '';

  var back = pcnEl('button', 'wai-pcn-back', '← Payment methods');
  back.type = 'button';
  back.addEventListener('click', showTopUpMethods);
  panel.appendChild(back);

  if (!state) {
    panel.appendChild(pcnEl('div', 'wai-topup-note', 'Loading…'));
    return;
  }

  var status = String(state.addressStatus || '');

  if (status === 'pool_empty') {
    // Deliberately no address of any kind here: showing a recycled or example
    // address would send someone's coin somewhere it can never be credited.
    panel.appendChild(pcnEl('div', 'wai-pcn-banner wai-pcn-banner-error',
      'We can\'t issue a deposit address right now. This is our problem and it has been logged. ' +
      'Please don\'t send anything until an address appears here.'));
  } else if (status === 'unclaimed') {
    panel.appendChild(pcnEl('div', 'wai-topup-note',
      'Claim your permanent PCN deposit address. It is yours for good — reuse it for every future deposit.'));
    var claimBtn = pcnEl('button', 'wai-pcn-btn', 'Get my deposit address');
    claimBtn.type = 'button';
    claimBtn.style.marginTop = '10px';
    claimBtn.addEventListener('click', function () { claimPcnAddress(claimBtn); });
    panel.appendChild(claimBtn);
  } else if (status === 'ok' && state.address) {
    renderPcnAddressBlock(panel, state);
  }

  var deposits = pcnEl('div', 'wai-pcn-deposits');
  deposits.appendChild(pcnEl('div', 'wai-pcn-label', 'Your deposits'));
  var list = pcnEl('div');
  list.id = 'wai-pcn-deposit-list';
  deposits.appendChild(list);
  panel.appendChild(deposits);
  renderPcnDeposits(state.deposits);
}

function renderPcnAddressBlock(panel, state) {
  panel.appendChild(pcnEl('div', 'wai-pcn-label', 'Your permanent PCN deposit address'));
  panel.appendChild(pcnEl('div', 'wai-pcn-address', String(state.address)));

  var qr = safeImageDataUri(state.qrSvg);
  if (qr) {
    var img = document.createElement('img');
    img.className = 'wai-pcn-qr';
    img.alt = 'QR code of your PCN deposit address';
    img.src = qr;
    panel.appendChild(img);
  }

  var actions = pcnEl('div', 'wai-pcn-actions');
  var copyBtn = pcnEl('button', 'wai-pcn-btn', 'Copy address');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', function () {
    copyToClipboard(String(state.address)).then(function () {
      copyBtn.textContent = 'Copied';
      setTimeout(function () { copyBtn.textContent = 'Copy address'; }, 1500);
    }).catch(function () {
      showAlert('Could not copy automatically. Select the address and copy it manually.');
    });
  });
  actions.appendChild(copyBtn);

  var explorer = safeHttpUrl(state.explorerUrl);
  if (explorer) {
    var link = pcnEl('a', 'wai-pcn-link', 'View on block explorer');
    link.href = explorer;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.appendChild(link);
  }
  panel.appendChild(actions);

  var rate = state.rate || {};
  if (!rate.ok) {
    panel.appendChild(pcnEl('div', 'wai-pcn-banner wai-pcn-banner-warn',
      'We can\'t quote a rate at this moment. Anything you send is still recorded and credits ' +
      'automatically once a rate is available again.'));
  }

  var minConf = numberOr(state.minConf, 6);
  var blockMinutes = numberOr(state.blockMinutes, 10);
  var coinbaseConf = numberOr(state.coinbaseMinConf, 0);

  var meta = pcnEl('div', 'wai-pcn-meta');
  if (rate.ok && rate.usdPerPcn != null) {
    meta.appendChild(pcnEl('div', null, 'Rate: 1 PCN = ' + formatUsd(rate.usdPerPcn) + rateAgeSuffix(rate.asOfSeconds)));
  }
  // Users who don't know this contact support ten minutes in, convinced the
  // money is gone. Say the wait out loud.
  meta.appendChild(pcnEl('div', null,
    'Credited after ' + minConf + ' confirmations, usually ' + describeWait(minConf, blockMinutes) + '.'));
  if (coinbaseConf > minConf) {
    meta.appendChild(pcnEl('div', null, 'Freshly mined coin needs ' + coinbaseConf + ' confirmations.'));
  }
  meta.appendChild(pcnEl('div', null, 'Send only PCN to this address.'));
  panel.appendChild(meta);
}

function renderPcnDeposits(deposits) {
  var host = document.getElementById('wai-pcn-deposit-list');
  if (!host) return;
  host.textContent = '';
  var list = Array.isArray(deposits) ? deposits : [];
  if (!list.length) {
    host.appendChild(pcnEl('div', 'wai-topup-note', 'No deposits yet. This list updates itself while the panel is open.'));
    return;
  }
  list.forEach(function (dep) {
    host.appendChild(buildPcnDepositRow(dep || {}));
  });
}

function buildPcnDepositRow(dep) {
  var row = pcnEl('div', 'wai-pcn-deposit');
  row.appendChild(pcnEl('span', 'wai-pcn-deposit-time', formatDepositTime(dep)));
  row.appendChild(pcnEl('span', 'wai-pcn-deposit-amount', depositPcn(dep) + ' PCN'));

  var status = String(dep.status || '');
  var text;
  var extraClass = '';
  if (status === 'credited') {
    text = dep.creditedUsd == null ? 'credited' : 'credited +' + formatUsd(dep.creditedUsd);
    extraClass = ' is-credited';
  } else if (status === 'rejected') {
    text = String(dep.note || 'rejected');
    extraClass = ' is-rejected';
  } else if (status === 'confirming') {
    text = numberOr(dep.confirmations, 0) + ' / ' + numberOr(dep.requiredConf, 6) + ' confirmations';
  } else {
    text = 'in the mempool';
  }
  row.appendChild(pcnEl('span', 'wai-pcn-deposit-status' + extraClass, text));

  var txUrl = safeHttpUrl(dep.explorerUrl);
  if (txUrl) {
    var link = pcnEl('a', 'wai-pcn-link', 'tx');
    link.href = txUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = String(dep.txid || '');
    row.appendChild(link);
  }
  return row;
}

// ---------------------------------------------------------------------------
// PCoin: claiming an address + polling deposits
// ---------------------------------------------------------------------------
function claimPcnAddress(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Requesting…'; }
  authedFetch(SERVER_URL + '/api/billing/pcoin/address', { method: 'POST' }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { ok: res.ok, status: res.status, data: data || {} };
    });
  }).then(function (r) {
    if (r.ok) {
      _pcnState = r.data;
      renderPcnPanel(_pcnState);
      return;
    }
    if (r.status === 409 || r.data.error === 'pool_empty') {
      _pcnState = Object.assign({}, _pcnState || {}, { addressStatus: 'pool_empty', address: null, qrSvg: null });
      renderPcnPanel(_pcnState);
      return;
    }
    if (r.status === 503 || r.data.error === 'not_configured') {
      closeTopUpOverlay();
      showAlert('PCN deposits are unavailable right now. Please use the card & crypto checkout.');
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Get my deposit address'; }
    showAlert(friendlyError(r.data.error, 'Could not issue a deposit address'));
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Get my deposit address'; }
    showAlert('Could not issue a deposit address: ' + e.message);
  });
}

function startPcnPoll() {
  stopPcnPoll();
  _pcnPollTimer = setInterval(refreshPcnDeposits, PCN_POLL_MS);
}

function stopPcnPoll() {
  if (_pcnPollTimer) { clearInterval(_pcnPollTimer); _pcnPollTimer = null; }
}

function refreshPcnDeposits() {
  if (!isTopUpOverlayOpen()) { stopPcnPoll(); return; }
  if (!authState.accessToken) return;
  authedFetch(SERVER_URL + '/api/billing/pcoin/deposits?limit=25', {}).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data || !isTopUpOverlayOpen()) return;
    var list = Array.isArray(data.deposits) ? data.deposits : [];
    if (_pcnState) _pcnState.deposits = list;
    renderPcnDeposits(list);
  }).catch(function () { /* transient — the next tick retries */ });
}

// ---------------------------------------------------------------------------
// Broadcast announcements
// ---------------------------------------------------------------------------
// The SSE channel only exists while the panel is open, so most announcements
// never arrive as an event -- GET /api/user/announcements on load is the real
// delivery path. Both routes end up in renderAnnouncement(), which de-dupes
// by id so an event and a fetch of the same announcement show one banner.
var _shownAnnouncements = {};

function fetchAnnouncements() {
  if (!authState.accessToken) return;
  authedFetch(SERVER_URL + '/api/user/announcements', {}).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data || !Array.isArray(data.announcements)) return;
    data.announcements.forEach(function (a) { renderAnnouncement(a); });
  }).catch(function () { /* silent — retried next time the panel opens */ });
}

function renderAnnouncement(a) {
  if (!a || a.id == null) return;
  var host = document.getElementById('wai-announcements');
  if (!host) return;
  var id = String(a.id);
  if (_shownAnnouncements[id]) return;
  _shownAnnouncements[id] = true;

  var severity = String(a.severity || 'info').toLowerCase();
  if (severity !== 'warning' && severity !== 'critical') severity = 'info';

  var banner = pcnEl('div', 'wai-announce wai-announce-' + severity);
  var body = pcnEl('div', 'wai-announce-body');
  if (a.title) body.appendChild(pcnEl('div', 'wai-announce-title', String(a.title)));
  if (a.body) body.appendChild(pcnEl('div', 'wai-announce-text', String(a.body)));

  var url = safeHttpUrl(a.url);
  if (url) {
    var link = pcnEl('a', 'wai-announce-link', 'Learn more');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    body.appendChild(link);
  }
  banner.appendChild(body);

  var closeBtn = pcnEl('button', 'wai-announce-close', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', function () {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    if (!host.children.length) host.style.display = 'none';
    ackAnnouncement(id);
  });
  banner.appendChild(closeBtn);

  host.appendChild(banner);
  host.style.display = '';
}

function ackAnnouncement(id) {
  if (!authState.accessToken) return;
  authedFetch(SERVER_URL + '/api/user/announcements/' + encodeURIComponent(id) + '/ack', {
    method: 'POST',
  }).catch(function () { /* the banner is already gone locally */ });
}

function clearAnnouncements() {
  _shownAnnouncements = {};
  var host = document.getElementById('wai-announcements');
  if (!host) return;
  host.textContent = '';
  host.style.display = 'none';
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
  if (isActiveStreaming()) {
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
  scriptsBtn.disabled = !(hasActiveSession && sessionIsSecuirty && !isActiveStreaming());
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
