// utils/dom-inspector.js — DOM inspection utilities for AI Web Assistant

(function() {
  'use strict';

  // Capture console errors
  const capturedErrors = [];
  const originalConsoleError = console.error;
  console.error = function(...args) {
    capturedErrors.push({
      message: args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch(e) { return String(a); }
      }).join(' '),
      timestamp: Date.now()
    });
    if (capturedErrors.length > 50) capturedErrors.shift();
    originalConsoleError.apply(console, args);
  };

  // Also capture unhandled errors
  window.addEventListener('error', (event) => {
    capturedErrors.push({
      message: `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      timestamp: Date.now()
    });
    if (capturedErrors.length > 50) capturedErrors.shift();
  });

  window.addEventListener('unhandledrejection', (event) => {
    capturedErrors.push({
      message: `Unhandled Promise: ${event.reason}`,
      timestamp: Date.now()
    });
    if (capturedErrors.length > 50) capturedErrors.shift();
  });

  // Highlight overlay management
  let highlightOverlays = [];

  window.ClaudeDOMInspector = {

    getPageContext() {
      const metaTags = [];
      document.querySelectorAll('meta').forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('http-equiv');
        const content = meta.getAttribute('content');
        if (name && content) {
          metaTags.push({ name, content: content.substring(0, 200) });
        }
      });

      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(h => {
        const text = h.textContent.trim().substring(0, 100);
        if (text) headings.push(`${h.tagName}: ${text}`);
      });

      const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

      return {
        url: window.location.href,
        title: document.title,
        description: description.substring(0, 300),
        headings: headings.slice(0, 30),
        metaTags: metaTags.slice(0, 20),
        linksCount: document.querySelectorAll('a').length,
        imagesCount: document.querySelectorAll('img').length,
        formsCount: document.querySelectorAll('form').length,
        scriptsCount: document.querySelectorAll('script').length,
        selectedText: window.getSelection()?.toString() || '',
        consoleErrors: capturedErrors.slice(-10),
        language: document.documentElement.lang || '',
        charset: document.characterSet || '',
        bodyTextLength: (document.body?.innerText || '').length
      };
    },

    getElementInfo(selector) {
      try {
        const el = document.querySelector(selector);
        if (!el) return { error: `No element found for selector: ${selector}` };

        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        const attributes = {};
        for (const attr of el.attributes) {
          attributes[attr.name] = attr.value.substring(0, 200);
        }

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          attributes,
          textContent: el.textContent.trim().substring(0, 500),
          innerHTML: el.innerHTML.substring(0, 1000),
          boundingRect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          isVisible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden',
          childElementCount: el.childElementCount,
          parentSelector: getUniqueSelector(el.parentElement),
          computedStyles: {
            display: styles.display,
            position: styles.position,
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            margin: styles.margin,
            padding: styles.padding,
            border: styles.border,
            zIndex: styles.zIndex,
            overflow: styles.overflow
          }
        };
      } catch (e) {
        return { error: e.message };
      }
    },

    getConsoleErrors() {
      return capturedErrors.slice();
    },

    getSelectedText() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return { text: '', context: '' };

      const text = selection.toString();
      let context = '';

      try {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const parentEl = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
        if (parentEl) {
          context = `Element: ${parentEl.tagName.toLowerCase()}`;
          if (parentEl.id) context += `#${parentEl.id}`;
          if (parentEl.className) context += `.${String(parentEl.className).split(' ').join('.')}`;
          context += `\nParent text: ${parentEl.textContent.trim().substring(0, 300)}`;
        }
      } catch(e) {
        // ignore
      }

      return { text, context };
    },

    getPageStructure(maxDepth = 4) {
      function buildTree(el, depth, maxChildren) {
        if (!el || depth > maxDepth) return '';

        let tag = el.tagName?.toLowerCase() || '';
        if (!tag) return '';

        let line = '  '.repeat(depth) + `<${tag}`;
        if (el.id) line += `#${el.id}`;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).slice(0, 3).join('.');
          if (classes) line += `.${classes}`;
        }

        const role = el.getAttribute('role');
        if (role) line += `[role="${role}"]`;

        const text = getDirectText(el).substring(0, 60);
        if (text) line += ` — "${text}"`;

        line += '\n';

        const children = el.children;
        const childCount = Math.min(children.length, maxChildren || 10);
        for (let i = 0; i < childCount; i++) {
          line += buildTree(children[i], depth + 1, 6);
        }
        if (children.length > childCount) {
          line += '  '.repeat(depth + 1) + `... (${children.length - childCount} more)\n`;
        }

        return line;
      }

      return buildTree(document.body, 0, 15);
    },

    highlightElement(selector) {
      this.clearHighlights();

      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) return { error: `No elements found for: ${selector}` };

        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          const overlay = document.createElement('div');
          overlay.className = 'claude-highlight-overlay';
          overlay.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background: rgba(124, 58, 237, 0.2);
            border: 2px solid #7C3AED;
            border-radius: 4px;
            z-index: 2147483645;
            pointer-events: none;
            transition: opacity 0.3s;
          `;
          document.body.appendChild(overlay);
          highlightOverlays.push(overlay);
        });

        // Auto-remove after 5 seconds
        setTimeout(() => this.clearHighlights(), 5000);

        return { highlighted: elements.length, selector };
      } catch(e) {
        return { error: e.message };
      }
    },

    clearHighlights() {
      highlightOverlays.forEach(el => el.remove());
      highlightOverlays = [];
      document.querySelectorAll('.claude-highlight-overlay').forEach(el => el.remove());
    },

    getComputedStylesFor(selector) {
      try {
        const el = document.querySelector(selector);
        if (!el) return { error: `No element found for: ${selector}` };

        const styles = window.getComputedStyle(el);
        const importantProps = [
          'display', 'position', 'top', 'right', 'bottom', 'left',
          'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
          'margin', 'padding', 'border', 'border-radius',
          'color', 'background-color', 'background',
          'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
          'flex-direction', 'justify-content', 'align-items', 'gap',
          'grid-template-columns', 'grid-template-rows',
          'overflow', 'z-index', 'opacity', 'visibility',
          'transform', 'transition', 'animation',
          'box-shadow', 'text-shadow', 'cursor'
        ];

        const result = {};
        for (const prop of importantProps) {
          const val = styles.getPropertyValue(prop);
          if (val && val !== 'none' && val !== 'normal' && val !== 'auto' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)') {
            result[prop] = val;
          }
        }
        return result;
      } catch(e) {
        return { error: e.message };
      }
    },

    executeQuery(code) {
      try {
        // Safety: only allow DOM query operations
        const disallowed = ['eval', 'Function', 'fetch', 'XMLHttpRequest', 'import', 'require',
          'chrome.', 'window.open', 'document.write', 'document.cookie',
          'localStorage', 'sessionStorage', 'indexedDB', 'WebSocket'];

        for (const term of disallowed) {
          if (code.includes(term)) {
            return { error: `Operation not allowed: ${term}` };
          }
        }

        // Execute and capture result
        const result = new Function(`
          'use strict';
          try {
            const result = ${code};
            if (result instanceof NodeList || result instanceof HTMLCollection) {
              return Array.from(result).map(el => ({
                tag: el.tagName?.toLowerCase(),
                id: el.id,
                class: el.className,
                text: el.textContent?.trim().substring(0, 200)
              }));
            }
            if (result instanceof Element) {
              return {
                tag: result.tagName?.toLowerCase(),
                id: result.id,
                class: result.className,
                text: result.textContent?.trim().substring(0, 200),
                html: result.outerHTML?.substring(0, 500)
              };
            }
            return result;
          } catch(e) {
            return { error: e.message };
          }
        `)();

        return { success: true, result };
      } catch(e) {
        return { error: e.message };
      }
    },

    getBodyText(maxLength = 3000) {
      const text = document.body?.innerText || '';
      return text.substring(0, maxLength);
    }
  };

  // Helper: get direct text content of an element (not children)
  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent.trim() + ' ';
      }
    }
    return text.trim();
  }

  // Helper: generate unique selector for an element
  function getUniqueSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${el.id}`;

    let selector = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) selector += `.${cls}`;
    }

    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    return selector;
  }

})();
