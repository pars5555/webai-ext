// commands.js — CDP/JS/ext execution, command handling
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var BASE64_IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,/;

// ---------------------------------------------------------------------------
// Page context helpers
// ---------------------------------------------------------------------------
function getPageContext(tabId) {
  return new Promise(function (resolve) {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
        return;
      }
      resolve({
        url: tab.url || '',
        title: tab.title || '',
        tabId: tab.id,
      });
    });
  });
}

async function collectRichPageContext(tabId) {
  var ctx = {};
  try {
    var res = await sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression: '(function(){' +
        'var h = []; document.querySelectorAll("h1,h2,h3").forEach(function(e){ h.push(e.tagName + ": " + e.textContent.trim().substring(0,80)); });' +
        'var forms = document.querySelectorAll("form").length;' +
        'var els = []; document.querySelectorAll(\'a,button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="tab"],[role="menuitem"]\').forEach(function(e){' +
        '  var r = e.getBoundingClientRect();' +
        '  if(r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {' +
        '    var text = (e.textContent || e.value || e.placeholder || e.getAttribute("aria-label") || e.getAttribute("data-testid") || "").trim().substring(0,60);' +
        '    if(!text && e.title) text = e.title.substring(0,60);' +
        '    els.push({' +
        '      tag: e.tagName.toLowerCase(),' +
        '      type: e.type || e.getAttribute("role") || e.getAttribute("contenteditable") || "",' +
        '      id: e.id || "",' +
        '      text: text,' +
        '      cx: Math.round(r.x + r.width/2),' +
        '      cy: Math.round(r.y + r.height/2),' +
        '      w: Math.round(r.width),' +
        '      h: Math.round(r.height)' +
        '    });' +
        '  }' +
        '});' +
        'var links = document.querySelectorAll("a").length;' +
        'var imgs = document.querySelectorAll("img").length;' +
        'var sel = window.getSelection().toString().substring(0,500);' +
        'var body = (document.body && document.body.innerText || "").substring(0, 3000);' +
        'return JSON.stringify({headings: h.slice(0,15), forms: forms, visibleElements: els.slice(0,40), links: links, images: imgs, selectedText: sel, bodyText: body});' +
        '})()',
      returnByValue: true, awaitPromise: false,
    });
    if (res.status === 'ok' && res.result && res.result.result && res.result.result.value) {
      try { Object.assign(ctx, JSON.parse(res.result.result.value)); } catch (e) {}
    }
  } catch (e) { /* non-critical */ }

  try {
    var cookieRes = await sendCdpCommand(tabId, 'Network.getCookies', {});
    if (cookieRes.status === 'ok' && cookieRes.result && cookieRes.result.cookies) {
      ctx.cookies = cookieRes.result.cookies.slice(0, 10).map(function (c) {
        return c.name + '=' + (c.value || '').substring(0, 30) + (c.value && c.value.length > 30 ? '...' : '');
      });
      ctx.cookieCount = cookieRes.result.cookies.length;
    }
  } catch (e) { /* non-critical */ }

  return ctx;
}

// ---------------------------------------------------------------------------
// Content script command bridge
// ---------------------------------------------------------------------------
function requestCommandData(tabId, command, arg) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_COMMAND', command: command, arg: arg }, function (response) {
      if (chrome.runtime.lastError || !response) {
        resolve({ error: 'Content script not available' });
        return;
      }
      resolve(response);
    });
  });
}

// ---------------------------------------------------------------------------
// Command handling (slash commands)
// ---------------------------------------------------------------------------
async function handleCommand(text, tabId) {
  var parts = text.split(/\s+/);
  var cmd = parts[0].toLowerCase();
  var arg = parts.slice(1).join(' ');

  switch (cmd) {
    case '/dom':
    case '/styles':
    case '/errors':
    case '/select':
    case '/structure':
    case '/query':
    case '/storage':
    case '/performance':
    case '/sources': {
      var result = await requestCommandData(tabId, cmd, arg);
      if (result.error) {
        addSystemMessage(result.error);
        return true;
      }
      if (result.displayOnly) {
        addSystemMessage(result.text);
        return true;
      }
      return result.context || null;
    }

    case '/highlight': {
      if (!arg) {
        addSystemMessage('Usage: /highlight <css-selector>');
        return true;
      }
      var result2 = await requestCommandData(tabId, cmd, arg);
      if (result2.error) {
        addSystemMessage('Highlight error: ' + result2.error);
      } else {
        addSystemMessage('Highlighted ' + result2.highlighted + ' element(s)');
      }
      return true;
    }

    case '/clear': {
      clearChat();
      return true;
    }

    case '/network': {
      chrome.runtime.sendMessage({ type: 'GET_NETWORK_LOG', tabId: tabId }, function (res) {
        if (chrome.runtime.lastError) {
          addSystemMessage('Could not retrieve network log.');
          return;
        }
        var log = (res && (res.log || res.entries)) || [];
        if (log.length === 0) {
          addSystemMessage('Network log: No requests captured.');
        } else {
          var w = messagesEl.querySelector('.wai-welcome');
          if (w) w.remove();
          addMessageToUI('user', '/network');
          var contextStr = 'Network log (' + log.length + ' requests):\n' + JSON.stringify(log.slice(0, 50), null, 2);
          var userContent = '/network\n\n[Context: ' + contextStr + ']';
          conversationHistory.push({ role: 'user', content: userContent });
          sendViaServerSSE(userContent, tabId);
          isStreaming = true;
          updateSendButton();
        }
      });
      return true;
    }

    case '/cookies': {
      var docCookies = await requestCommandData(tabId, '/cookies', '');
      chrome.runtime.sendMessage({ type: 'GET_COOKIES', url: docCookies.url || '' }, function (res) {
        if (chrome.runtime.lastError) return;
        var chromeCookies = (res && res.cookies) || [];
        var combined = {
          documentCookies: docCookies.cookies || [],
          chromeCookies: chromeCookies
        };
        var contextStr = 'Cookies for this page:\n' + JSON.stringify(combined, null, 2);

        var w = messagesEl.querySelector('.wai-welcome');
        if (w) w.remove();
        addMessageToUI('user', '/cookies');
        var userContent = '/cookies\n\n[Context: ' + contextStr + ']';
        conversationHistory.push({ role: 'user', content: userContent });
        sendViaServerSSE(userContent, tabId);
        isStreaming = true;
        updateSendButton();
      });
      return true;
    }

    case '/cdp': {
      if (!arg) {
        addSystemMessage('Usage: /cdp <method> [params JSON]\nExample: /cdp Runtime.evaluate {"expression": "1+1"}');
        return true;
      }
      var cdpParts = arg.match(/^(\S+)\s*(.*)?$/);
      var cdpMethod = cdpParts ? cdpParts[1] : arg;
      var cdpParams = {};
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
      }, function (res) {
        if (chrome.runtime.lastError) {
          addSystemMessage('CDP error: ' + chrome.runtime.lastError.message);
          return;
        }
        var contextStr = 'CDP ' + cdpMethod + ' result:\n' + JSON.stringify(res, null, 2);

        var w = messagesEl.querySelector('.wai-welcome');
        if (w) w.remove();
        addMessageToUI('user', '/cdp ' + arg);
        var userContent = '/cdp ' + arg + '\n\n[Context: ' + contextStr + ']';
        conversationHistory.push({ role: 'user', content: userContent });
        sendViaServerSSE(userContent, tabId);
        isStreaming = true;
        updateSendButton();
      });
      return true;
    }

    case '/logs': {
      chrome.runtime.sendMessage({ type: 'GET_EXTENSION_LOGS', count: 50 }, function (res) {
        if (chrome.runtime.lastError) {
          addSystemMessage('Could not retrieve logs: ' + chrome.runtime.lastError.message);
          return;
        }
        var logs = (res && res.logs) || 'No logs';
        addSystemMessage('Extension Logs:\n' + logs);
      });
      return true;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CDP/JS auto-execution from AI response
// ---------------------------------------------------------------------------
async function executeCdpFromResponse(responseText, tabId, targetSid) {
  if (!responseText || !tabId) return null;
  if (autoExecCancelled) return null;

  var results = [];

  var allBlocksRegex = /```(cdp|js|javascript|ext|bash|sh|shell|webfetch|websearch|captcha)\s*\n([\s\S]*?)```/g;
  var match;
  while ((match = allBlocksRegex.exec(responseText)) !== null) {
    if (autoExecCancelled) return results;
    var blockType = match[1] === 'javascript' ? 'js' : match[1];
    if (blockType === 'sh' || blockType === 'shell') blockType = 'bash';
    var rawCmd = match[2].trim();

    if (blockType === 'ext') {
      try {
        var cmd = JSON.parse(rawCmd);
        var res = await handleExtInAutoExec(cmd);
        var label = cmd.api || cmd.action || 'ext';
        results.push({ type: 'ext', action: label, result: JSON.stringify(res, null, 2).substring(0, 5000) });
        var resTabId = res.tabId || (res.result && res.result.tabId);
        if (resTabId) {
          tabId = resTabId;
          taskTabId = resTabId;
        }
      } catch (e) {
        results.push({ type: 'ext_error', action: rawCmd.substring(0, 50), error: e.message });
      }

    } else if (blockType === 'js') {
      try {
        var safeCode = rawCmd.replace(/\b(const|let)\s+/g, 'var ');
        var jsRes = await sendCdpCommand(tabId, 'Runtime.evaluate', {
          expression: safeCode,
          returnByValue: true,
          awaitPromise: true,
          generatePreview: true,
          userGesture: true,
          allowUnsafeEvalBlockedByCSP: true,
          replMode: true,
        });
        if (jsRes.status === 'ok') {
          var jsResult = jsRes.result;
          if (jsResult && jsResult.exceptionDetails) {
            results.push({ type: 'js_error', error: 'Error: ' + (jsResult.exceptionDetails.exception && jsResult.exceptionDetails.exception.description || jsResult.exceptionDetails.text || 'Unknown error') });
          } else {
            var value = jsResult && jsResult.result && jsResult.result.value;
            var preview = jsResult && jsResult.result && jsResult.result.preview;
            var desc = jsResult && jsResult.result && jsResult.result.description;
            var display;
            if (value !== undefined && value !== null) {
              display = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
            } else if (preview) {
              display = JSON.stringify(preview, null, 2);
            } else if (desc) {
              display = desc;
            } else {
              display = '(' + (jsResult && jsResult.result && jsResult.result.type || 'undefined') + ')';
            }
            results.push({ type: 'js', result: display.substring(0, 5000) });
          }
        } else {
          results.push({ type: 'js_error', error: jsRes.error || 'Unknown error' });
        }
      } catch (e) {
        results.push({ type: 'js_error', error: e.message });
      }

    } else if (blockType === 'cdp') {
      try {
        var cdpCmd;
        try {
          cdpCmd = JSON.parse(rawCmd);
        } catch (jsonErr) {
          if (/^(await\s|document\.|window\.|var |let |const |function |\(|Array\.)/.test(rawCmd)) {
            var safeExpr = rawCmd.replace(/\b(const|let)\s+/g, 'var ');
            var evalRes = await sendCdpCommand(tabId, 'Runtime.evaluate', { expression: safeExpr, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true, userGesture: true });
            if (evalRes.status === 'ok' && !(evalRes.result && evalRes.result.exceptionDetails)) {
              var val = evalRes.result && evalRes.result.result && evalRes.result.result.value;
              results.push({ type: 'js', result: (val !== undefined ? (typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)) : '(undefined)').substring(0, 5000) });
            } else {
              results.push({ type: 'js_error', error: (evalRes.result && evalRes.result.exceptionDetails && evalRes.result.exceptionDetails.exception && evalRes.result.exceptionDetails.exception.description) || evalRes.error || 'Unknown error' });
            }
            continue;
          }
          var methodMatch = rawCmd.match(/^([A-Z][a-zA-Z]+\.[a-zA-Z]+)\s*(\{[\s\S]*\})?$/);
          if (methodMatch) {
            var method = methodMatch[1];
            var params = {};
            if (methodMatch[2]) { try { params = JSON.parse(methodMatch[2]); } catch (e) {} }
            var mRes = await sendCdpCommand(tabId, method, params);
            results.push(mRes.status === 'ok'
              ? { type: 'cdp', method: method, result: JSON.stringify(mRes.result, null, 2).substring(0, 5000) }
              : { type: 'cdp_error', method: method, error: mRes.error || 'Unknown error' });
            continue;
          }
          results.push({ type: 'cdp_error', method: rawCmd.substring(0, 50), error: 'Invalid JSON. Use: {"method": "...", "params": {...}}' });
          continue;
        }
        if (cdpCmd.action && !cdpCmd.method) {
          var extRes = await handleExtInAutoExec(cdpCmd);
          results.push({ type: 'ext', action: cdpCmd.action, result: JSON.stringify(extRes, null, 2).substring(0, 5000) });
          if (extRes.tabId) { tabId = extRes.tabId; taskTabId = extRes.tabId; }
          continue;
        }
        if (cdpCmd.method) {
          var targetTab = cdpCmd.tabId || tabId;
          if (cdpCmd.method === 'Runtime.evaluate' && cdpCmd.params && cdpCmd.params.expression) {
            cdpCmd.params.expression = cdpCmd.params.expression.replace(/\b(const|let)\s+/g, 'var ');
          }
          var cdpRes = await sendCdpCommand(targetTab, cdpCmd.method, cdpCmd.params || {});
          if (cdpRes.status === 'ok') {
            var displayResult = JSON.stringify(cdpRes.result, null, 2);
            results.push({ type: 'cdp', method: cdpCmd.method, result: (displayResult || '').substring(0, cdpCmd.method === 'Page.captureScreenshot' ? 500000 : 5000) });
          } else {
            results.push({ type: 'cdp_error', method: cdpCmd.method, error: cdpRes.error || 'Unknown error' });
          }
        }
      } catch (e) {
        results.push({ type: 'cdp_error', method: rawCmd.substring(0, 50), error: e.message });
      }

    } else if (blockType === 'bash') {
      try {
        var bashRes = await executeServerTool('bash', rawCmd);
        results.push({ type: 'bash', command: rawCmd.substring(0, 100), result: bashRes.substring(0, 10000) });
      } catch (e) {
        results.push({ type: 'bash_error', command: rawCmd.substring(0, 100), error: e.message });
      }

    } else if (blockType === 'webfetch' || blockType === 'websearch') {
      try {
        var fetchRes = await executeServerTool(blockType, rawCmd);
        results.push({ type: blockType, url: rawCmd.substring(0, 200), result: fetchRes.substring(0, 10000) });
      } catch (e) {
        results.push({ type: blockType + '_error', url: rawCmd.substring(0, 200), error: e.message });
      }

    } else if (blockType === 'captcha') {
      var captchaType = 'recaptcha_v2';
      try {
        var captchaInfo = JSON.parse(rawCmd);
        captchaType = captchaInfo.type || 'recaptcha_v2';
      } catch (e) {}

      var promptTypeMap = {
        'recaptcha_v2': 'captcha-recaptcha-v2',
        'recaptcha': 'captcha-recaptcha-v2',
        'hcaptcha': 'captcha-hcaptcha',
        'turnstile': 'captcha-turnstile',
        'slide': 'captcha-geetest',
        'geetest': 'captcha-geetest',
        'geetest_slide': 'captcha-geetest',
        'funcaptcha': 'captcha-funcaptcha',
        'datadome': 'captcha-datadome',
      };
      var promptType = promptTypeMap[captchaType] || 'captcha-recaptcha-v2';

      var captchaIcons = {
        'recaptcha_v2': 'https://upload.wikimedia.org/wikipedia/commons/a/ad/RecaptchaLogo.svg',
        'recaptcha': 'https://upload.wikimedia.org/wikipedia/commons/a/ad/RecaptchaLogo.svg',
        'hcaptcha': chrome.runtime.getURL('icons/captcha-hcaptcha.svg'),
        'turnstile': 'https://www.cloudflare.com/favicon.ico',
        'slide': chrome.runtime.getURL('icons/captcha-geetest.png'),
        'geetest': chrome.runtime.getURL('icons/captcha-geetest.png'),
        'geetest_slide': chrome.runtime.getURL('icons/captcha-geetest.png'),
        'funcaptcha': 'https://www.arkoselabs.com/favicon.ico',
        'datadome': 'https://datadome.co/favicon.ico',
      };
      var iconUrl = captchaIcons[captchaType] || '';
      var iconHtml = iconUrl ? '<img src="' + iconUrl + '" style="width:100px;height:100px;display:block;margin:8px auto;border-radius:8px;">' : '';
      addCaptchaSystemMessage(iconHtml + '<div>' + captchaType + ' detected \u2014 loading solver...</div>', targetSid);
      try {
        var captchaResp = await fetch(SERVER_URL + '/api/internal-prompt/' + promptType, { headers: getAuthHeaders() });
        if (captchaResp.ok) {
          var captchaData = await captchaResp.json();
          if (captchaData.content) {
            results.push({ type: 'captcha_instructions', result: captchaData.content });
            addCaptchaSystemMessage('<div>' + captchaType + ' solver activated</div>', targetSid);
          }
        }
      } catch (e) { /* silent */ }
      results.push({ type: 'captcha', result: captchaType + ' CAPTCHA detected. Solving instructions appended below.' });
    }
  }

  return results.length > 0 ? results : null;
}

// ---------------------------------------------------------------------------
// Server tool execution (bash, webfetch, websearch)
// ---------------------------------------------------------------------------
async function executeServerTool(tool, command) {
  var resp = await fetch(SERVER_URL + '/api/tools/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ tool: tool, command: command }),
  });
  if (!resp.ok) {
    var err = await resp.json().catch(function () { return {}; });
    throw new Error(err.error || 'Server tool execution failed (' + resp.status + ')');
  }
  var data = await resp.json();
  if (data.stdout !== undefined) {
    var output = data.stdout || '';
    if (data.stderr) output += (output ? '\n' : '') + '[stderr] ' + data.stderr;
    if (data.exitCode && data.exitCode !== 0) output += '\n[exit code: ' + data.exitCode + ']';
    if (data.timedOut) output += '\n[TIMED OUT after ' + data.durationMs + 'ms]';
    return output || '(no output)';
  }
  return data.result || data.output || JSON.stringify(data);
}

// ---------------------------------------------------------------------------
// Extension command handling
// ---------------------------------------------------------------------------
async function handleExtInAutoExec(cmd) {
  if (cmd.api === 'chrome.tabs.update' || (cmd.action && /switch|activate|focus/i.test(cmd.action))) {
    var tid = cmd.args ? cmd.args[0] : (cmd.tabId || cmd.id);
    var updateProps = cmd.args ? cmd.args[1] : { active: true };
    if (tid && updateProps && updateProps.active) {
      var tabInfo = await new Promise(function (resolve) {
        chrome.tabs.update(tid, { active: true }, function (tab) {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve({ result: { tabId: tab.id, url: tab.url, title: tab.title, status: 'targeted' } });
          }
        });
      });
      if (tabInfo.error) return tabInfo;
      try {
        var domRes = await sendCdpCommand(tid, 'Runtime.evaluate', {
          expression: '(function(){ var t = document.title; var u = window.location.href; var text = (document.body && document.body.innerText || "").slice(0, 1000); return JSON.stringify({title: t, url: u, bodyText: text}); })()',
          returnByValue: true,
          awaitPromise: false,
        });
        if (domRes.status === 'ok' && domRes.result && domRes.result.result && domRes.result.result.value) {
          try { tabInfo.result.pageSnapshot = JSON.parse(domRes.result.result.value); } catch (e) {}
        }
      } catch (e) { /* non-critical */ }
      return tabInfo;
    }
  }

  return executeExtCommand(cmd);
}

function executeExtCommand(cmd) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(Object.assign({ type: 'EXT_COMMAND' }, cmd), function (response) {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { error: 'No response' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CDP command bridge
// ---------------------------------------------------------------------------
function sendCdpCommand(tabId, method, params) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'CDP_COMMAND', method: method, params: params, tabId: tabId }, function (response) {
      if (chrome.runtime.lastError) {
        resolve({ status: 'error', error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { status: 'error', error: 'No response' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------
function formatCdpResultsForChat(results) {
  return results.map(function (r) {
    if (r.type === 'cdp') return '\n\n---\n**CDP Result** (`' + r.method + '`):\n```json\n' + r.result + '\n```';
    if (r.type === 'cdp_error') return '\n\n---\n**CDP Error** (`' + r.method + '`): ' + r.error;
    if (r.type === 'js') return '\n\n---\n**JS Result:**\n```\n' + r.result + '\n```';
    if (r.type === 'js_error') return '\n\n---\n**JS Error:** ' + r.error;
    if (r.type === 'ext') return '\n\n---\n**Extension** (`' + r.action + '`):\n```json\n' + r.result + '\n```';
    if (r.type === 'ext_error') return '\n\n---\n**Extension Error** (`' + r.action + '`): ' + r.error;
    if (r.type === 'bash') return '\n\n---\n**Bash** (`' + (r.command || '') + '`):\n```\n' + r.result + '\n```';
    if (r.type === 'bash_error') return '\n\n---\n**Bash Error** (`' + (r.command || '') + '`): ' + r.error;
    if (r.type === 'webfetch') return '\n\n---\n**WebFetch:**\n```\n' + r.result + '\n```';
    if (r.type === 'webfetch_error') return '\n\n---\n**WebFetch Error:** ' + r.error;
    if (r.type === 'websearch') return '\n\n---\n**WebSearch:**\n```\n' + r.result + '\n```';
    if (r.type === 'websearch_error') return '\n\n---\n**WebSearch Error:** ' + r.error;
    return '';
  }).join('');
}

function formatCdpResultsAsPrompt(results) {
  var prompt = 'Here are the execution results from the commands you provided:\n\n';
  var images = [];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var resultText = r.result || '';
    var extracted = null;

    if (r.type === 'cdp' || r.type === 'ext' || r.type === 'js') {
      extracted = extractImagesFromResult(resultText);
    }

    if (extracted && extracted.length > 0) {
      var lbl = r.type === 'cdp' ? 'CDP ' + r.method : r.type === 'ext' ? 'Extension ' + r.action : 'JS';
      prompt += lbl + ' returned: [screenshot captured \u2014 see attached image]\n\n';
      for (var j = 0; j < extracted.length; j++) {
        images.push(extracted[j]);
      }
    } else {
      if (r.type === 'cdp') prompt += 'CDP ' + r.method + ' returned:\n' + resultText + '\n\n';
      if (r.type === 'cdp_error') prompt += 'CDP ' + r.method + ' ERROR: ' + r.error + '\n\n';
      if (r.type === 'js') prompt += 'JS execution returned:\n' + resultText + '\n\n';
      if (r.type === 'js_error') prompt += 'JS execution ERROR: ' + r.error + '\n\n';
      if (r.type === 'ext') prompt += 'Extension ' + r.action + ' returned:\n' + resultText + '\n\n';
      if (r.type === 'ext_error') prompt += 'Extension ' + r.action + ' ERROR: ' + r.error + '\n\n';
      if (r.type === 'bash') prompt += 'Bash (' + (r.command || '') + ') returned:\n' + resultText + '\n\n';
      if (r.type === 'bash_error') prompt += 'Bash (' + (r.command || '') + ') ERROR: ' + r.error + '\n\n';
      if (r.type === 'webfetch') prompt += 'WebFetch returned:\n' + resultText + '\n\n';
      if (r.type === 'webfetch_error') prompt += 'WebFetch ERROR: ' + r.error + '\n\n';
      if (r.type === 'websearch') prompt += 'WebSearch returned:\n' + resultText + '\n\n';
      if (r.type === 'websearch_error') prompt += 'WebSearch ERROR: ' + r.error + '\n\n';
      if (r.type === 'captcha') prompt += resultText + '\n\n';
      if (r.type === 'captcha_instructions') prompt += '\n--- CAPTCHA SOLVING INSTRUCTIONS ---\n' + resultText + '\n--- END CAPTCHA INSTRUCTIONS ---\n\n';
    }
  }
  prompt += 'Based on these results, continue with the task. If the task is complete, summarize what was done. If more steps are needed, provide the next commands to execute.';
  return { text: prompt, images: images };
}

// ---------------------------------------------------------------------------
// Network event flushing
// ---------------------------------------------------------------------------
function flushNetEvents(tabId) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: 'FLUSH_NET_EVENTS', tabId: tabId }, function (resp) {
      if (!resp || !resp.events || resp.events.length === 0) { resolve(null); return; }
      var evts = resp.events;
      var skipTypes = ['Image', 'Font', 'Stylesheet', 'Media'];
      var filtered = evts.filter(function (e) { return skipTypes.indexOf(e.type) === -1; });
      if (filtered.length === 0) { resolve(null); return; }
      var lines = ['[Network Monitor \u2014 ' + filtered.length + ' request(s) captured]'];
      for (var i = 0; i < filtered.length; i++) {
        var e = filtered[i];
        var size = e.size ? (e.size > 1024 ? (e.size / 1024).toFixed(1) + 'KB' : e.size + 'B') : '?';
        var timing = e.timing ? e.timing + 'ms' : '';
        var status = e.status || 'pending';
        var postNote = e.hasPostData ? ' [has body]' : '';
        lines.push((i + 1) + '. [' + e.requestId + '] ' + e.method + ' ' + e.url + ' (' + status + ', ' + size + (timing ? ', ' + timing : '') + ', ' + (e.mimeType || e.type || '') + ')' + postNote);
      }
      lines.push('');
      lines.push('To inspect a request body: use CDP {"method": "Network.getResponseBody", "params": {"requestId": "ID"}} or {"method": "Network.getRequestPostData", "params": {"requestId": "ID"}}');
      resolve(lines.join('\n'));
    });
  });
}

// ---------------------------------------------------------------------------
// Image extraction from results
// ---------------------------------------------------------------------------
function extractImagesFromResult(resultStr) {
  if (!resultStr || resultStr.length < 100) return null;
  var images = [];

  if (BASE64_IMG_RE.test(resultStr)) {
    var parts = resultStr.split(',');
    var mediaMatch = parts[0].match(/data:image\/(\w+);base64/);
    if (mediaMatch) {
      images.push({ media_type: 'image/' + mediaMatch[1], data: parts.slice(1).join(',') });
      return images;
    }
  }

  try {
    var obj = JSON.parse(resultStr);
    var b64 = obj.data || obj.screenshot;
    if (b64 && typeof b64 === 'string' && b64.length > 1000) {
      var mt = 'image/jpeg';
      if (b64.startsWith('iVBOR')) mt = 'image/png';
      else if (b64.startsWith('R0lGOD')) mt = 'image/gif';
      else if (b64.startsWith('UklGR')) mt = 'image/webp';
      images.push({ media_type: mt, data: b64 });
      return images;
    }
  } catch (e) {}

  if (resultStr.length > 1000 && /^(\/9j\/|iVBOR|R0lGOD|UklGR)/.test(resultStr.trim())) {
    var mt2 = 'image/jpeg';
    if (resultStr.trim().startsWith('iVBOR')) mt2 = 'image/png';
    images.push({ media_type: mt2, data: resultStr.trim() });
    return images;
  }

  return null;
}
