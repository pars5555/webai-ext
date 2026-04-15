// streaming.js — SSE streaming, message sending, stream handlers
'use strict';

// ---------------------------------------------------------------------------
// Per-task state lives on each session entry (sessions.get(sid)):
//   .isStreaming      — true while a stream is in flight
//   .autoFollowUpCount — CDP/JS auto-exec loop counter for THIS session
//   .autoExecCancelled — stop flag for THIS session's auto-exec loop
//   .taskTabId        — current CDP target tab (may change if AI creates tab)
//   .stepSendTime     — last step's send timestamp (for AI timing)
//   .messageQueue     — messages queued while this session is streaming
//   .streamText       — accumulated delta text
//   .abortController  — fetch abort handle for stopping
//   .tabId            — original tab the session was created from
//
// Only MAX_AUTO_FOLLOW_UPS stays module-scoped since it's a constant.
// ---------------------------------------------------------------------------
var MAX_AUTO_FOLLOW_UPS = 100;

// ---------------------------------------------------------------------------
// Queue processing — operates on the ACTIVE session only. If user is on a
// different tab, the queued messages sit on that session until the user
// switches back (handled in switchToSession).
// ---------------------------------------------------------------------------
function processQueue() {
  if (!activeSessionId || !sessions.has(activeSessionId)) return;
  var session = sessions.get(activeSessionId);
  if (session.isStreaming) return;
  if (!session.messageQueue || session.messageQueue.length === 0) return;
  var next = session.messageQueue.shift();
  doSendMessage(next.text, next.attachments, true);
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------
async function sendMessage() {
  var text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';

  // Only queue if the ACTIVE session is streaming. If user is on a tab with
  // no session (or a different session that isn't streaming), treat this as
  // a brand-new request for the current tab.
  if (isActiveStreaming()) {
    var queuedAttachments = [].concat(pendingAttachments);
    pendingAttachments = [];
    renderAttachments();
    var activeSession = sessions.get(activeSessionId);
    if (!activeSession.messageQueue) activeSession.messageQueue = [];
    activeSession.messageQueue.push({ text: text, attachments: queuedAttachments });
    var welcome = messagesEl.querySelector('.wai-welcome');
    if (welcome) welcome.remove();
    var qMsgEl = addMessageToUI('user', text);
    if (queuedAttachments.length > 0 && qMsgEl) {
      var qBubble = qMsgEl.querySelector('.wai-message-bubble');
      if (qBubble) appendAttachmentThumbs(qBubble, queuedAttachments);
    }
    scrollToBottom();
    return;
  }

  doSendMessage(text, pendingAttachments, false);
  pendingAttachments = [];
  renderAttachments();
}

async function doSendMessage(text, attachments, alreadyShown) {
  var tabId = currentTabId;
  if (!tabId) {
    tabId = await getActiveTabId();
  }
  if (!tabId) {
    addSystemMessage('No active tab found.');
    processQueue();
    return;
  }

  if (!authState.isAuthenticated) {
    showAuthOverlay();
    processQueue();
    return;
  }

  var commandResult = await handleCommand(text, tabId);
  if (commandResult === true) { processQueue(); return; }

  var userMessage = text;
  var extraContext = '';
  if (commandResult && typeof commandResult === 'string') {
    extraContext = commandResult;
  }

  var isNewSession = !activeSessionId;
  if (isNewSession) {
    var tempId = 'pending-' + tabId + '-' + Date.now();
    var el = createSessionContainer(tempId);
    sessions.set(tempId, {
      el: el,
      history: [],
      isStreaming: true,
      streamText: '',
      tabId: tabId,
      taskTabId: tabId,
      autoFollowUpCount: 0,
      autoExecCancelled: false,
      stepSendTime: 0,
      messageQueue: [],
      model: modelSelect.value,
      promptType: promptSelect ? promptSelect.value : 'general',
      title: text.substring(0, 50),
      loaded: true,
      inputValue: '',
      inputAttachments: [],
    });
    addSessionToSelector(tempId, text.substring(0, 30) + (text.length > 30 ? '...' : ''));
    switchToSession(tempId);
  } else {
    // Reset per-task counters at the start of a new user turn in an existing session.
    var curSession = sessions.get(activeSessionId);
    if (curSession) {
      curSession.autoFollowUpCount = 0;
      curSession.autoExecCancelled = false;
      curSession.taskTabId = tabId;
    }
  }

  var welcome = messagesEl.querySelector('.wai-welcome');
  if (welcome) welcome.remove();

  scrollToBottom(true);
  var atts = attachments || [];
  if (!alreadyShown) {
    var msgEl = addMessageToUI('user', text);
    if (atts.length > 0 && msgEl) {
      var bubble = msgEl.querySelector('.wai-message-bubble');
      appendAttachmentThumbs(bubble, atts);
    }
  }

  var fullUserContent = userMessage + (extraContext ? '\n\n[Context: ' + extraContext + ']' : '');

  var imageAttachments = atts.filter(function (a) { return a.isImage; });
  var textAttachments = atts.filter(function (a) { return !a.isImage; });

  var historyContent = fullUserContent;
  if (textAttachments.length > 0) {
    var textParts = textAttachments.map(function (a) {
      try {
        return '\n\n[File: ' + a.name + ']\n' + atob(a.base64);
      } catch (e) {
        return '\n\n[File: ' + a.name + ' (binary, ' + Math.round(a.base64.length * 3 / 4 / 1024) + 'KB)]';
      }
    });
    historyContent = fullUserContent + textParts.join('');
  }

  if (imageAttachments.length > 0) {
    var contentParts = [];
    for (var i = 0; i < imageAttachments.length; i++) {
      contentParts.push({
        type: 'image',
        source: { type: 'base64', media_type: imageAttachments[i].mediaType, data: imageAttachments[i].base64 }
      });
    }
    contentParts.push({ type: 'text', text: historyContent });
    conversationHistory.push({ role: 'user', content: contentParts });
  } else {
    conversationHistory.push({ role: 'user', content: historyContent });
  }

  var isFirstMessage = isNewSession;
  var pageContext = null;
  if (isFirstMessage) {
    try {
      var pageCtx = await getPageContext(tabId);
      var rich = await collectRichPageContext(tabId);
      pageContext = Object.assign({}, pageCtx || {}, rich || {});
    } catch (e) { /* non-critical */ }
  }

  var nowSession = activeSessionId && sessions.get(activeSessionId);
  if (nowSession) nowSession.stepSendTime = Date.now();
  var userImages = imageAttachments.length > 0 ? imageAttachments.map(function (img) {
    return { media_type: img.mediaType, data: img.base64 };
  }) : null;

  if (atts.length > 0) {
    var sid = activeSessionId || chatSessionId;
    var uploadPromises = atts.map(function (att) {
      return fetch(SERVER_URL + '/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ sessionId: sid, name: att.name, mediaType: att.mediaType || att.type, data: att.base64 }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.url) return { name: att.name, url: SERVER_URL + data.url };
        return null;
      }).catch(function () { return null; });
    });
    var uploaded = await Promise.all(uploadPromises);
    var fileRefs = uploaded.filter(Boolean);
    if (fileRefs.length > 0) {
      historyContent += '\n\n[Attached files saved on server \u2014 use these URLs to fetch file data for form uploads via JS fetch():\n';
      fileRefs.forEach(function (f) { historyContent += '  - "' + f.name + '": ' + f.url + '\n'; });
      historyContent += ']';
    }
  }

  sendViaServerSSE(historyContent, tabId, 0, pageContext, false, null, userImages);

  if (activeSessionId && sessions.has(activeSessionId)) {
    sessions.get(activeSessionId).isStreaming = true;
  }
  updateSendButton();
  updateContextMeter();
}

// ---------------------------------------------------------------------------
// Server SSE Chat
// ---------------------------------------------------------------------------
async function sendViaServerSSE(userMessage, tabId, retryCount, pageContext, isExec, forSessionId, images) {
  retryCount = retryCount || 0;

  var targetSid = forSessionId || activeSessionId;

  var serverSessionId = (targetSid && !targetSid.startsWith('pending-')) ? targetSid : undefined;

  var body = {
    message: userMessage,
    tabId: tabId,
    sessionId: serverSessionId,
  };
  if (pageContext) body.pageContext = pageContext;
  if (isExec) body.isExec = true;
  if (images && images.length > 0) body.images = images;
  var currentPromptType = promptSelect.value || 'general';
  if (currentPromptType && currentPromptType !== 'general') {
    body.promptType = currentPromptType;
  }

  var controller = new AbortController();
  if (targetSid && sessions.has(targetSid)) {
    sessions.get(targetSid).abortController = controller;
  }

  onStreamStart(targetSid);

  try {
    var response = await fetch(SERVER_URL + '/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      var errorData = await response.json().catch(function () { return {}; });
      var status = response.status;

      reportError('CHAT_API', 'HTTP ' + status + ': ' + (errorData.error || errorData.message || 'Server error'));

      if (status === 401 && retryCount < 1) {
        var refreshed = await refreshAccessToken();
        if (refreshed) {
          var container = getSessionContainer(targetSid);
          var streamingMsg = container.querySelector('.streaming-msg');
          if (streamingMsg) streamingMsg.remove();
          return sendViaServerSSE(userMessage, tabId, retryCount + 1, pageContext, isExec, targetSid);
        } else {
          clearAuthState();
          showAuthOverlay();
          onStreamError('Session expired. Please sign in again.', targetSid);
          return;
        }
      } else if (status === 402) {
        onStreamError('Insufficient balance. Please add credits to continue.', targetSid);
        return;
      } else if (status === 403) {
        clearAuthState();
        showAuthOverlay();
        onStreamError('Access denied. Please sign in to continue.', targetSid);
        return;
      }

      onStreamError(errorData.error || errorData.message || 'Server error ' + status, targetSid);
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullResponse = '';
    var streamEnded = false;

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data: ')) continue;
        var data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        try {
          var event = JSON.parse(data);
          if (event.type === 'session') {
            var realSessionId = event.sessionId;

            if (targetSid && targetSid.startsWith('pending-') && sessions.has(targetSid)) {
              var session = sessions.get(targetSid);
              sessions.delete(targetSid);
              session.el.dataset.sessionId = realSessionId;
              session.pendingId = targetSid;
              sessions.set(realSessionId, session);

              fetch(SERVER_URL + '/api/files/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ fromSessionId: targetSid, toSessionId: realSessionId }),
              }).catch(function () {});

              removeSessionFromSelector(targetSid);
              addSessionToSelector(realSessionId, session.title);

              if (activeSessionId === targetSid) {
                activeSessionId = realSessionId;
                chatSessionId = realSessionId;
                if (sessionSelect) sessionSelect.value = realSessionId;
              }

              targetSid = realSessionId;
            } else {
              if (targetSid === activeSessionId) {
                chatSessionId = realSessionId;
              }
            }
          } else if (event.type === 'delta') {
            fullResponse += event.text;
            onStreamDelta(event.text, targetSid);
          } else if (event.type === 'done' && !streamEnded) {
            var finalText = event.fullText || fullResponse;
            onStreamEnd(finalText, false, targetSid);
            streamEnded = true;
          } else if (event.type === 'error') {
            reportError('CHAT_API', 'SSE error event: ' + (event.error || event.message || 'Stream error'));
            onStreamError(event.error || event.message || 'Stream error', targetSid);
            streamEnded = true;
          }
        } catch (e) {
          if (!streamEnded && data.includes('"type":"done"') && data.includes('"fullText"')) {
            var fullTextMatch = data.match(/"fullText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (fullTextMatch) {
              var extractedText = fullTextMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
              onStreamEnd(extractedText, false, targetSid);
              streamEnded = true;
            }
          }
        }
      }
    }

    if (!streamEnded) {
      onStreamEnd(fullResponse, false, targetSid);
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      var abortSession = sessions.get(targetSid);
      var streamText = abortSession ? abortSession.streamText || '' : '';
      onStreamEnd(streamText, true, targetSid);
    } else {
      var errMsg = error.message || 'Unknown error';
      reportError('CHAT_API', 'Fetch error: ' + errMsg);
      if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('ERR_CONNECTION_REFUSED')) {
        errMsg = 'Cannot connect to server at ' + SERVER_URL + '. Is the server running?';
      }
      onStreamError(errMsg, targetSid);
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming handlers
// ---------------------------------------------------------------------------
function onStreamStart(targetSid) {
  if (targetSid && sessions.has(targetSid)) {
    var s = sessions.get(targetSid);
    s.streamText = '';
    s.autoExecCancelled = false;
    s.isStreaming = true;
  }
  var container = getSessionContainer(targetSid);
  var msgEl = createMessageElement('assistant', '');
  msgEl.classList.add('streaming-msg');
  container.appendChild(msgEl);
  if (targetSid === activeSessionId) {
    updateSendButton();
    scrollToBottom();
  }
}

function onStreamDelta(text, targetSid) {
  var session = sessions.get(targetSid);
  var streamText = session ? (session.streamText || '') + text : text;
  if (session) session.streamText = streamText;
  var container = getSessionContainer(targetSid);
  var msgEl = container.querySelector('.streaming-msg');
  if (msgEl) {
    var bubble = msgEl.querySelector('.wai-message-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(streamText);
      attachCodeActions(bubble);
    }
  }
  if (targetSid === activeSessionId) scrollToBottom();
}

function onStreamEnd(fullText, cancelled, targetSid) {
  var hist = getSessionHistory(targetSid);
  var container = getSessionContainer(targetSid);
  var msgEl = container.querySelector('.streaming-msg');
  if (msgEl) {
    msgEl.classList.remove('streaming-msg');
    if (fullText) {
      var bubble = msgEl.querySelector('.wai-message-bubble');
      if (bubble) {
        bubble.innerHTML = renderMarkdown(fullText);
        attachCodeActions(bubble);
      }
    }
  } else if (fullText) {
    var newMsg = createMessageElement('assistant', fullText);
    container.appendChild(newMsg);
  }

  if (fullText && !cancelled) {
    hist.push({ role: 'assistant', content: fullText });
  }

  if (targetSid === activeSessionId) {
    updateContextMeter();
    scrollToBottom();
  }

  var endedSession = targetSid && sessions.get(targetSid);
  var execTabId = (endedSession && endedSession.taskTabId) || (endedSession && endedSession.tabId) || currentTabId;
  var aiResponseMs = (endedSession && endedSession.stepSendTime) ? (Date.now() - endedSession.stepSendTime) : 0;

  if (fullText && !cancelled && execTabId && endedSession) {
    var execStart = Date.now();
    executeCdpFromResponse(fullText, execTabId, targetSid).then(function (cdpResults) {
      var execMs = Date.now() - execStart;
      if (endedSession.autoExecCancelled) {
        addSystemMessageToContainer(container, 'Stopped by user.');
        finishTask(targetSid);
        return;
      }
      if (cdpResults && cdpResults.length > 0) {
        endedSession.autoFollowUpCount = (endedSession.autoFollowUpCount || 0) + 1;
        if (endedSession.autoFollowUpCount > MAX_AUTO_FOLLOW_UPS) {
          addSystemMessageToContainer(container, 'Auto-execution limit reached (' + MAX_AUTO_FOLLOW_UPS + ' steps). Type a message to continue.');
          finishTask(targetSid);
          return;
        }

        var stepTotalMs = aiResponseMs + execMs;
        var profile = 'AI: ' + (aiResponseMs / 1000).toFixed(1) + 's | Exec: ' + (execMs / 1000).toFixed(1) + 's | Total: ' + (stepTotalMs / 1000).toFixed(1) + 's';

        var chatResults = formatCdpResultsForChat(cdpResults);
        addSystemMessageToContainer(container, 'Step ' + endedSession.autoFollowUpCount + ' executed \u2014 ' + cdpResults.length + ' command(s) \u2014 ' + profile + chatResults);

        var curHist = getSessionHistory(targetSid);
        if (curHist.length > 0) {
          var last = curHist[curHist.length - 1];
          if (last.role === 'assistant') {
            last.content += chatResults;
          }
        }

        // execTabId may have been updated by commands.js (e.g. ext createTab).
        var nextTab = endedSession.taskTabId || execTabId;

        chrome.tabs.get(nextTab, function (tab) {
          if (chrome.runtime.lastError || !tab) {
            addSystemMessageToContainer(container, 'Tab closed \u2014 stopping.');
            finishTask(targetSid);
            return;
          }

          var formatted = formatCdpResultsAsPrompt(cdpResults);
          var followUpText = formatted.text;
          var followUpImages = formatted.images || [];
          flushNetEvents(nextTab).then(function (netSummary) {
            if (netSummary) followUpText += '\n\n' + netSummary;
            var curHist2 = getSessionHistory(targetSid);
            curHist2.push({ role: 'user', content: followUpText });

            endedSession.isStreaming = true;
            endedSession.stepSendTime = Date.now();
            if (targetSid === activeSessionId) updateSendButton();
            sendViaServerSSE(followUpText, nextTab, 0, null, true, targetSid, followUpImages);
          });
        });
      } else {
        finishTask(targetSid);
      }
    }).catch(function (e) {
      console.error('CDP auto-exec error:', e);
      finishTask(targetSid);
    });
  } else {
    finishTask(targetSid);
  }
}

function onStreamError(error, targetSid) {
  if (targetSid && sessions.has(targetSid)) {
    var s = sessions.get(targetSid);
    s.isStreaming = false;
    s.abortController = null;
  }
  if (targetSid === activeSessionId) updateSendButton();

  var container = getSessionContainer(targetSid);
  var streamingMsg = container.querySelector('.streaming-msg');
  if (streamingMsg) streamingMsg.remove();

  var errorEl = document.createElement('div');
  errorEl.className = 'wai-error-msg';
  errorEl.innerHTML = ICONS.error + '<span>' + escapeHtml(error) + '</span>';
  container.appendChild(errorEl);
  if (targetSid === activeSessionId) scrollToBottom();

  inputEl.focus();
  processQueue();
}

// ---------------------------------------------------------------------------
// Stop / finish
// ---------------------------------------------------------------------------
function stopCurrentStream() {
  if (!activeSessionId || !sessions.has(activeSessionId)) return;
  var session = sessions.get(activeSessionId);
  if (!session.isStreaming) return;

  session.autoExecCancelled = true;
  if (session.abortController) {
    session.abortController.abort();
    session.abortController = null;
  }
  var cleanupTab = session.taskTabId || session.tabId || currentTabId;

  var killSid = activeSessionId;
  fetch(SERVER_URL + '/api/chat/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ sessionId: killSid }),
  }).catch(function () {});

  if (cleanupTab) {
    chrome.runtime.sendMessage({ type: 'CDP_CLEANUP', tabId: cleanupTab });
  }

  session.autoFollowUpCount = 0;
  session.isStreaming = false;

  var container = session.el || messagesEl;
  var streamingMsgEl = container.querySelector('.streaming-msg');
  if (streamingMsgEl) {
    var bubble = streamingMsgEl.querySelector('.wai-message-bubble');
    if (bubble && bubble.textContent.trim()) {
      streamingMsgEl.classList.remove('streaming-msg');
    } else {
      streamingMsgEl.remove();
    }
  }

  updateSendButton();
  addSystemMessage('Stopped by user.');
}

function finishTask(targetSid) {
  var session = targetSid && sessions.get(targetSid);
  var cleanupTabId = (session && (session.taskTabId || session.tabId)) || currentTabId;
  if (cleanupTabId) {
    chrome.runtime.sendMessage({ type: 'CDP_CLEANUP', tabId: cleanupTabId });
  }

  fetch(SERVER_URL + '/api/tools/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  }).catch(function () {});

  if (session) {
    session.isStreaming = false;
    session.streamText = '';
    session.abortController = null;
    session.autoFollowUpCount = 0;
  }

  if (targetSid === activeSessionId) {
    updateSendButton();
    updateContextMeter();
  }

  if (session && session.messageQueue && session.messageQueue.length > 0) {
    var next = session.messageQueue.shift();
    if (targetSid !== activeSessionId) {
      switchToSession(targetSid);
    }
    doSendMessage(next.text, next.attachments, true);
    return;
  }

  // Notify if user is on a different tab
  chrome.storage.sync.get(['notifyOnFinish'], function (result) {
    if (!result.notifyOnFinish) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var activeTab = tabs[0];
      var sessionTabId = targetSid && sessions.has(targetSid) ? sessions.get(targetSid).tabId : currentTabId;
      if (activeTab && activeTab.id !== sessionTabId) {
        chrome.runtime.sendMessage({
          type: 'NOTIFY',
          title: 'Task finished',
          message: (sessions.has(targetSid) ? sessions.get(targetSid).title || '' : '').substring(0, 80) || 'AI response complete',
          tabId: sessionTabId
        });
      }
    });
  });

  inputEl.focus();
  processQueue();
}
