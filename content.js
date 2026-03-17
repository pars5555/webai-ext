// content.js — AI Web Assistant content script
// Minimal version: provides page data to the side panel via message passing.
// No chat UI injected into the page.

(function () {
  'use strict';

  if (window.__claudeWebAssistantInjected) return;
  window.__claudeWebAssistantInjected = true;

  // ---------------------------------------------------------------------------
  // Gather page context (used by side panel before sending chat messages)
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

    // Detect canvases and capture their content as data URLs
    const canvasInfo = [];
    try {
      const canvases = document.querySelectorAll('canvas');
      canvases.forEach((canvas, i) => {
        if (canvas.width > 0 && canvas.height > 0) {
          const rect = canvas.getBoundingClientRect();
          const info = {
            index: i,
            width: canvas.width,
            height: canvas.height,
            id: canvas.id || null,
            className: canvas.className || null,
            visible: rect.width > 0 && rect.height > 0,
            position: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          };
          // Try to capture canvas content (may fail due to tainted canvas)
          try {
            if (info.visible && rect.width > 10 && rect.height > 10) {
              info.dataUrl = canvas.toDataURL('image/jpeg', 0.5);
            }
          } catch (e) {
            info.tainted = true;
          }
          canvasInfo.push(info);
        }
      });
    } catch (e) { /* ignore */ }

    const result = Object.assign({}, domContext, { pageData: pageData });
    if (canvasInfo.length > 0) {
      result.canvases = canvasInfo;
      result.hasCanvases = true;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Execute commands requested by the side panel
  // ---------------------------------------------------------------------------
  function executeCommand(command, arg) {
    switch (command) {
      case '/dom': {
        const ctx = window.ClaudeDOMInspector ? window.ClaudeDOMInspector.getPageContext() : {};
        return { context: 'Full page context:\n' + JSON.stringify(ctx, null, 2) };
      }

      case '/styles': {
        if (!arg) return { displayOnly: true, text: 'Usage: /styles <css-selector>' };
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const styles = window.ClaudeDOMInspector.getComputedStylesFor(arg);
        return { context: 'Computed styles for "' + arg + '":\n' + JSON.stringify(styles, null, 2) };
      }

      case '/errors': {
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const errors = window.ClaudeDOMInspector.getConsoleErrors();
        if (errors.length === 0) return { context: 'Console errors: None captured.' };
        return { context: 'Console errors:\n' + JSON.stringify(errors, null, 2) };
      }

      case '/select': {
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const sel = window.ClaudeDOMInspector.getSelectedText();
        if (!sel.text) return { displayOnly: true, text: 'No text selected. Select text on the page first.' };
        return { context: 'Selected text: "' + sel.text + '"\nContext: ' + sel.context };
      }

      case '/structure': {
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const structure = window.ClaudeDOMInspector.getPageStructure();
        return { context: 'Page DOM structure:\n' + structure };
      }

      case '/highlight': {
        if (!arg) return { error: 'Usage: /highlight <css-selector>' };
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const hlResult = window.ClaudeDOMInspector.highlightElement(arg);
        if (hlResult.error) return { error: hlResult.error };
        return { highlighted: hlResult.highlighted };
      }

      case '/query': {
        if (!arg) return { displayOnly: true, text: 'Usage: /query <javascript-expression>' };
        if (!window.ClaudeDOMInspector) return { error: 'DOM Inspector not available.' };
        const qResult = window.ClaudeDOMInspector.executeQuery(arg);
        return { context: 'Query result for `' + arg + '`:\n' + JSON.stringify(qResult, null, 2), result: qResult };
      }

      case '/cookies': {
        const cookies = window.ClaudePageDataCollector
          ? window.ClaudePageDataCollector.getCookiesSummary()
          : [];
        return { cookies: cookies, url: window.location.href };
      }

      case '/storage': {
        if (!window.ClaudePageDataCollector) return { error: 'Page Data Collector not available.' };
        const storageData = {
          localStorage: window.ClaudePageDataCollector.getLocalStorage(),
          sessionStorage: window.ClaudePageDataCollector.getSessionStorage()
        };
        return { context: 'Storage data:\n' + JSON.stringify(storageData, null, 2) };
      }

      case '/performance': {
        if (!window.ClaudePageDataCollector) return { error: 'Page Data Collector not available.' };
        const perfData = window.ClaudePageDataCollector.getPerformanceData();
        return { context: 'Performance data:\n' + JSON.stringify(perfData, null, 2) };
      }

      case '/sources': {
        if (!window.ClaudePageDataCollector) return { error: 'Page Data Collector not available.' };
        const sources = window.ClaudePageDataCollector.getPageSources();
        return { context: 'Page sources:\n' + JSON.stringify(sources, null, 2) };
      }

      default:
        return { error: 'Unknown command: ' + command };
    }
  }

  // ---------------------------------------------------------------------------
  // Listen for messages from side panel / background
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.type) {
      case 'GET_PAGE_CONTEXT':
        sendResponse(gatherPageContext());
        return true;

      case 'EXECUTE_COMMAND':
        sendResponse(executeCommand(message.command, message.arg));
        return true;
    }
  });

})();
