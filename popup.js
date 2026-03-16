// popup.js — Claude Web Assistant popup script

document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const openChatBtn = document.getElementById('open-chat-btn');
  const pageToggle = document.getElementById('page-toggle');
  const toggleTitle = document.getElementById('toggle-title');
  const toggleHost = document.getElementById('toggle-host');
  const settingsBtn = document.getElementById('settings-btn');
  const versionText = document.getElementById('version-text');

  // Show extension version from manifest
  const manifest = chrome.runtime.getManifest();
  versionText.textContent = 'v' + manifest.version;

  // ── Connection status ─────────────────────────────────────────────────────
  chrome.runtime.sendMessage({ type: 'GET_AUTH_CONFIG' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      statusText.textContent = 'Not configured';
      return;
    }

    const mode = res.activeAuthSource || 'bridge';
    const hasApiKey = !!(res.apiKey && res.apiKey.trim());

    if (mode === 'apikey' && hasApiKey) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected via API Key';
    } else if (mode === 'bridge') {
      // Check bridge connection
      statusText.textContent = 'Checking bridge...';
      chrome.runtime.sendMessage({ type: 'CHECK_BRIDGE' }, (bridgeRes) => {
        if (chrome.runtime.lastError) {
          statusText.textContent = 'Bridge not reachable';
          return;
        }
        if (bridgeRes && bridgeRes.status === 'ok') {
          statusDot.classList.add('connected');
          const modeLabel = bridgeRes.mode === 'native' ? 'Native' : 'HTTP';
          statusText.textContent = `Connected via Claude Code (${modeLabel})`;
        } else {
          statusText.textContent = 'Bridge not connected';
        }
      });
    } else {
      statusText.textContent = 'Not configured — open Settings';
    }
  });

  // ── Current tab hostname + page-enabled state ──────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) {
      toggleHost.textContent = '';
      toggleTitle.textContent = 'No active page';
      pageToggle.disabled = true;
      return;
    }

    let hostname;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      toggleHost.textContent = '';
      toggleTitle.textContent = 'No active page';
      pageToggle.disabled = true;
      return;
    }

    // Show hostname
    toggleHost.textContent = hostname;

    // Check if enabled for this page
    chrome.runtime.sendMessage(
      { type: 'GET_PAGE_ENABLED', url: tab.url },
      (res) => {
        if (chrome.runtime.lastError || !res) return;
        pageToggle.checked = res.enabled !== false;
      }
    );
  });

  // ── Open Chat button ───────────────────────────────────────────────────────
  openChatBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_PANEL' }).catch(() => {});
      }
    });
    window.close();
  });

  // ── Per-page toggle ────────────────────────────────────────────────────────
  pageToggle.addEventListener('change', () => {
    const enabled = pageToggle.checked;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) return;

      // Tell background to persist the setting
      chrome.runtime.sendMessage({
        type: 'SET_PAGE_ENABLED',
        url: tab.url,
        enabled
      });

      // Toggle visibility on the page immediately
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_VISIBILITY',
        visible: enabled
      }).catch(() => {});
    });
  });

  // ── Settings link ──────────────────────────────────────────────────────────
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
});
