// options.js — Claude Web Assistant Settings Page

(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────

  const DEFAULTS = {
    activeAuthSource: 'bridge',
    connectionMode: 'native',
    apiKey: '',
    bridgeUrl: 'http://127.0.0.1:3456',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    theme: 'dark',
    autoAttachCdp: false,
    disabledHostnames: [],
  };

  const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

  // ─── DOM References ──────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Version
  const elExtVersion = $('#ext-version');
  const elAboutVersion = $('#about-version');

  // Auth source
  const radioCards = $$('.radio-card');
  const radioBridge = $('input[name="authSource"][value="bridge"]');
  const radioApikey = $('input[name="authSource"][value="apikey"]');
  const panelBridge = $('#auth-panel-bridge');
  const panelApikey = $('#auth-panel-apikey');

  // Bridge
  const elBridgeDot = $('#bridge-dot');
  const elBridgeStatusText = $('#bridge-status-text');
  const elConnectionModeSelect = $('#connection-mode-select');
  const elConnectionModeHint = $('#connection-mode-hint');
  const elSetupStepsNative = $('#setup-steps-native');
  const elSetupStepsHttp = $('#setup-steps-http');
  const elBridgeUrlGroup = $('#bridge-url-group');
  const elBridgeUrlInput = $('#bridge-url-input');
  const elSaveBridgeUrlBtn = $('#save-bridge-url-btn');
  const elTestBridgeBtn = $('#test-bridge-btn');
  const elBridgeTestResult = $('#bridge-test-result');

  // API Key
  const elApiKeyInput = $('#api-key-input');
  const elSaveApiKeyBtn = $('#save-api-key-btn');
  const elApiKeyDot = $('#api-key-dot');
  const elApiKeyStatusText = $('#api-key-status-text');
  const elTestApiKeyBtn = $('#test-api-key-btn');
  const elTestResult = $('#test-result');

  // General Settings
  const elModelSelect = $('#model-select');
  const elMaxTokensSlider = $('#max-tokens-slider');
  const elMaxTokensValue = $('#max-tokens-value');
  const elThemeSelect = $('#theme-select');
  const elAutoAttachCdp = $('#auto-attach-cdp');

  // Per-page
  const elHostnameInput = $('#hostname-input');
  const elAddHostnameBtn = $('#add-hostname-btn');
  const elHostnameList = $('#hostname-list');
  const elHostnameEmpty = $('#hostname-empty');
  const elClearHostnamesBtn = $('#clear-hostnames-btn');

  // About / reset
  const elResetAllBtn = $('#reset-all-btn');

  // Toast
  const elToast = $('#toast');

  // ─── State ───────────────────────────────────────────────────

  let currentSettings = { ...DEFAULTS };
  let toastTimer = null;
  let saveDebounceTimer = null;

  // ─── Init ────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setVersion();
    loadAllSettings().then(() => {
      renderAuthSource();
      renderBridgeStatus();
      renderApiKeyStatus();
      renderGeneralSettings();
      renderHostnameList();
    });
    bindEvents();
  }

  // ─── Version ─────────────────────────────────────────────────

  function setVersion() {
    let version = '1.0.0';
    try {
      if (chrome && chrome.runtime && chrome.runtime.getManifest) {
        version = chrome.runtime.getManifest().version;
      }
    } catch (e) {
      // fallback
    }
    elExtVersion.textContent = version;
    elAboutVersion.textContent = version;
  }

  // ─── Storage helpers ─────────────────────────────────────────

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => resolve(result));
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, () => resolve());
    });
  }

  function storageClearAll() {
    return Promise.all([
      new Promise((resolve) => chrome.storage.sync.clear(resolve)),
      new Promise((resolve) => chrome.storage.local.clear(resolve)),
    ]);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response);
      });
    });
  }

  // ─── Load All Settings ───────────────────────────────────────

  async function loadAllSettings() {
    try {
      const [authResult, settingsResult, urlsResult, storageResult] = await Promise.all([
        sendMessage({ type: 'GET_AUTH_CONFIG' }).catch(() => null),
        sendMessage({ type: 'GET_SETTINGS' }).catch(() => null),
        sendMessage({ type: 'GET_DISABLED_URLS' }).catch(() => null),
        storageGet([
          'activeAuthSource', 'connectionMode', 'apiKey', 'bridgeUrl',
          'model', 'maxTokens', 'theme', 'autoAttachCdp', 'disabledHostnames',
        ]),
      ]);

      // Merge from message responses if available, otherwise use direct storage
      if (authResult && authResult.activeAuthSource !== undefined) {
        currentSettings.activeAuthSource = authResult.activeAuthSource || DEFAULTS.activeAuthSource;
        currentSettings.connectionMode = authResult.connectionMode || DEFAULTS.connectionMode;
        currentSettings.apiKey = authResult.apiKey || '';
        currentSettings.bridgeUrl = authResult.bridgeUrl || DEFAULTS.bridgeUrl;
      } else {
        currentSettings.activeAuthSource = storageResult.activeAuthSource || DEFAULTS.activeAuthSource;
        currentSettings.connectionMode = storageResult.connectionMode || DEFAULTS.connectionMode;
        currentSettings.apiKey = storageResult.apiKey || '';
        currentSettings.bridgeUrl = storageResult.bridgeUrl || DEFAULTS.bridgeUrl;
      }

      if (settingsResult && settingsResult.model !== undefined) {
        currentSettings.model = settingsResult.model || DEFAULTS.model;
        currentSettings.maxTokens = settingsResult.maxTokens || DEFAULTS.maxTokens;
        currentSettings.autoAttachCdp = settingsResult.autoAttachCdp === true;
        currentSettings.theme = settingsResult.theme || DEFAULTS.theme;
        if (settingsResult.bridgeUrl) currentSettings.bridgeUrl = settingsResult.bridgeUrl;
      } else {
        currentSettings.model = storageResult.model || DEFAULTS.model;
        currentSettings.maxTokens = storageResult.maxTokens || DEFAULTS.maxTokens;
        currentSettings.autoAttachCdp = storageResult.autoAttachCdp === true;
        currentSettings.theme = storageResult.theme || DEFAULTS.theme;
      }

      if (urlsResult && Array.isArray(urlsResult)) {
        currentSettings.disabledHostnames = urlsResult;
      } else if (urlsResult && Array.isArray(urlsResult.disabledUrls)) {
        currentSettings.disabledHostnames = urlsResult.disabledUrls;
      } else {
        currentSettings.disabledHostnames = storageResult.disabledHostnames || [];
      }
    } catch (e) {
      const storageResult = await storageGet(Object.keys(DEFAULTS));
      Object.keys(DEFAULTS).forEach((key) => {
        currentSettings[key] = storageResult[key] !== undefined ? storageResult[key] : DEFAULTS[key];
      });
    }
  }

  // ─── Render: Auth Source ─────────────────────────────────────

  function renderAuthSource() {
    const isBridge = currentSettings.activeAuthSource === 'bridge';

    radioBridge.checked = isBridge;
    radioApikey.checked = !isBridge;

    radioCards.forEach((card) => {
      const input = card.querySelector('input[type="radio"]');
      card.classList.toggle('selected', input.checked);
    });

    panelBridge.classList.toggle('hidden', !isBridge);
    panelApikey.classList.toggle('hidden', isBridge);
  }

  // ─── Render: Bridge Status ───────────────────────────────────

  async function renderBridgeStatus() {
    // Render connection mode
    elConnectionModeSelect.value = currentSettings.connectionMode;
    renderConnectionMode();
    elBridgeUrlInput.value = currentSettings.bridgeUrl;

    // Auto-check bridge on load
    try {
      const result = await sendMessage({ type: 'CHECK_BRIDGE' });
      if (result && result.status === 'ok') {
        elBridgeDot.classList.add('active');
        const claudeVersion = result.claude?.version || result.claude?.ok ? 'detected' : 'unknown';
        elBridgeStatusText.textContent = `Connected — Claude Code ${claudeVersion}`;
      } else {
        elBridgeDot.classList.remove('active');
        elBridgeStatusText.textContent = result?.error || 'Not connected';
      }
    } catch (e) {
      elBridgeDot.classList.remove('active');
      elBridgeStatusText.textContent = 'Not connected';
    }
  }

  function renderConnectionMode() {
    const isNative = currentSettings.connectionMode === 'native';
    elSetupStepsNative.classList.toggle('hidden', !isNative);
    elSetupStepsHttp.classList.toggle('hidden', isNative);
    elBridgeUrlGroup.classList.toggle('hidden', isNative);
    elConnectionModeHint.textContent = isNative
      ? 'Native messaging auto-launches Claude Code when you send a message. Requires one-time setup.'
      : 'HTTP bridge requires running "node bridge.js" in a terminal before using the extension.';
  }

  // ─── Render: API Key Status ──────────────────────────────────

  function renderApiKeyStatus() {
    const hasKey = currentSettings.apiKey && currentSettings.apiKey.length > 0;
    elApiKeyDot.classList.toggle('active', hasKey);

    if (hasKey) {
      const masked = '••••••••' + currentSettings.apiKey.slice(-4);
      elApiKeyInput.value = '';
      elApiKeyInput.placeholder = masked;
      elApiKeyStatusText.textContent = 'API key configured (' + currentSettings.apiKey.slice(-4) + ')';
    } else {
      elApiKeyInput.value = '';
      elApiKeyInput.placeholder = 'sk-ant-api03-...';
      elApiKeyStatusText.textContent = 'No API key configured';
    }
  }

  // ─── Render: General Settings ────────────────────────────────

  function renderGeneralSettings() {
    elModelSelect.value = currentSettings.model;
    elMaxTokensSlider.value = currentSettings.maxTokens;
    elMaxTokensValue.textContent = currentSettings.maxTokens;
    updateSliderFill();
    elThemeSelect.value = currentSettings.theme;
    elAutoAttachCdp.checked = currentSettings.autoAttachCdp;
  }

  function updateSliderFill() {
    const min = parseInt(elMaxTokensSlider.min);
    const max = parseInt(elMaxTokensSlider.max);
    const val = parseInt(elMaxTokensSlider.value);
    const pct = ((val - min) / (max - min)) * 100;
    elMaxTokensSlider.style.setProperty('--slider-pct', pct + '%');
  }

  // ─── Render: Hostname List ───────────────────────────────────

  function renderHostnameList() {
    const hostnames = currentSettings.disabledHostnames || [];

    elHostnameList.innerHTML = '';

    if (hostnames.length === 0) {
      elHostnameEmpty.classList.remove('hidden');
      elClearHostnamesBtn.classList.add('hidden');
      return;
    }

    elHostnameEmpty.classList.add('hidden');
    elClearHostnamesBtn.classList.remove('hidden');

    hostnames.forEach((hostname) => {
      const item = document.createElement('div');
      item.className = 'hostname-item';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = hostname;

      const removeBtn = document.createElement('button');
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      removeBtn.addEventListener('click', () => removeHostname(hostname));

      item.appendChild(nameSpan);
      item.appendChild(removeBtn);
      elHostnameList.appendChild(item);
    });
  }

  // ─── Bind Events ─────────────────────────────────────────────

  function bindEvents() {
    // Auth source toggle
    radioCards.forEach((card) => {
      card.addEventListener('click', () => {
        const input = card.querySelector('input[type="radio"]');
        input.checked = true;

        const source = input.value;
        currentSettings.activeAuthSource = source;
        renderAuthSource();
        saveAuthSource(source);
      });
    });

    // Connection mode
    elConnectionModeSelect.addEventListener('change', () => {
      currentSettings.connectionMode = elConnectionModeSelect.value;
      renderConnectionMode();
      sendMessage({ type: 'SET_SETTINGS', connectionMode: currentSettings.connectionMode }).catch(() => null);
      storageSet({ connectionMode: currentSettings.connectionMode });
      showToast('Connection mode updated', 'success');
    });

    // Bridge: save URL
    elSaveBridgeUrlBtn.addEventListener('click', saveBridgeUrl);
    elBridgeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBridgeUrl();
    });

    // Bridge: test
    elTestBridgeBtn.addEventListener('click', testBridgeConnection);

    // API Key: save
    elSaveApiKeyBtn.addEventListener('click', saveApiKey);
    elApiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKey();
    });

    // API Key: test
    elTestApiKeyBtn.addEventListener('click', testApiKey);

    // Model
    elModelSelect.addEventListener('change', () => {
      currentSettings.model = elModelSelect.value;
      saveGeneralSettings();
      showToast('Model updated', 'success');
    });

    // Max tokens
    elMaxTokensSlider.addEventListener('input', () => {
      const val = parseInt(elMaxTokensSlider.value);
      elMaxTokensValue.textContent = val;
      updateSliderFill();
      currentSettings.maxTokens = val;
      debounceSaveGeneralSettings();
    });

    // Theme
    elThemeSelect.addEventListener('change', () => {
      currentSettings.theme = elThemeSelect.value;
      saveGeneralSettings();
      showToast('Theme updated', 'success');
    });

    // Auto-attach CDP
    elAutoAttachCdp.addEventListener('change', () => {
      currentSettings.autoAttachCdp = elAutoAttachCdp.checked;
      saveGeneralSettings();
      showToast(elAutoAttachCdp.checked ? 'Auto-attach CDP enabled' : 'Auto-attach CDP disabled', 'success');
    });

    // Hostname: add
    elAddHostnameBtn.addEventListener('click', addHostname);
    elHostnameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addHostname();
    });

    // Hostname: clear all
    elClearHostnamesBtn.addEventListener('click', clearAllHostnames);

    // Reset all
    elResetAllBtn.addEventListener('click', resetAll);
  }

  // ─── Actions: Auth Source ────────────────────────────────────

  async function saveAuthSource(source) {
    try {
      await sendMessage({
        type: 'SET_AUTH_CONFIG',
        activeAuthSource: source,
      }).catch(() => null);
      await storageSet({ activeAuthSource: source });
      const label = source === 'bridge' ? 'Claude Code (Bridge)' : 'API Key';
      showToast('Auth source switched to ' + label, 'success');
    } catch (e) {
      showToast('Failed to save auth source', 'error');
    }
  }

  // ─── Actions: Bridge ─────────────────────────────────────────

  async function saveBridgeUrl() {
    const url = elBridgeUrlInput.value.trim();
    if (!url) {
      showToast('Please enter a bridge URL', 'error');
      return;
    }

    try {
      new URL(url); // validate URL format
    } catch (e) {
      showToast('Invalid URL format', 'error');
      return;
    }

    try {
      currentSettings.bridgeUrl = url;
      await sendMessage({
        type: 'SET_AUTH_CONFIG',
        bridgeUrl: url,
      }).catch(() => null);
      await sendMessage({
        type: 'SET_SETTINGS',
        bridgeUrl: url,
      }).catch(() => null);
      await storageSet({ bridgeUrl: url });
      showToast('Bridge URL saved', 'success');
    } catch (e) {
      showToast('Failed to save bridge URL', 'error');
    }
  }

  async function testBridgeConnection() {
    elTestBridgeBtn.disabled = true;
    elTestBridgeBtn.textContent = 'Testing...';
    showBridgeTestResult('Connecting to bridge server...', 'loading');

    try {
      const result = await sendMessage({ type: 'CHECK_BRIDGE' });

      if (result && result.status === 'ok') {
        const claudeOk = result.claude?.ok;
        const claudeVersion = result.claude?.version || '';

        if (claudeOk) {
          showBridgeTestResult(
            'Bridge connected! Claude Code ' + claudeVersion,
            'success'
          );
          elBridgeDot.classList.add('active');
          elBridgeStatusText.textContent = 'Connected — Claude Code ' + claudeVersion;
        } else {
          showBridgeTestResult(
            'Bridge running but Claude Code not found. Install it: npm install -g @anthropic-ai/claude-code',
            'error'
          );
          elBridgeDot.classList.remove('active');
          elBridgeStatusText.textContent = 'Bridge running, Claude Code missing';
        }
      } else {
        showBridgeTestResult(
          'Cannot reach bridge server: ' + (result?.error || 'Unknown error') + '\n\nMake sure the bridge is running: node bridge.js',
          'error'
        );
        elBridgeDot.classList.remove('active');
        elBridgeStatusText.textContent = 'Not connected';
      }
    } catch (e) {
      showBridgeTestResult('Error: ' + (e.message || 'Unknown error'), 'error');
      elBridgeDot.classList.remove('active');
      elBridgeStatusText.textContent = 'Not connected';
    } finally {
      elTestBridgeBtn.disabled = false;
      elTestBridgeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Test Bridge Connection';
    }
  }

  function showBridgeTestResult(message, type) {
    elBridgeTestResult.textContent = message;
    elBridgeTestResult.className = 'test-result ' + type;
  }

  // ─── Actions: API Key ────────────────────────────────────────

  async function saveApiKey() {
    const key = elApiKeyInput.value.trim();
    if (!key) {
      showToast('Please enter an API key', 'error');
      return;
    }

    if (!key.startsWith('sk-ant-')) {
      showToast('API key should start with sk-ant-', 'error');
      return;
    }

    elSaveApiKeyBtn.disabled = true;
    elSaveApiKeyBtn.textContent = 'Saving...';

    try {
      await sendMessage({
        type: 'SET_AUTH_CONFIG',
        activeAuthSource: 'apikey',
        apiKey: key,
      }).catch(() => null);
      await storageSet({ apiKey: key, activeAuthSource: 'apikey' });

      currentSettings.apiKey = key;
      renderApiKeyStatus();
      showToast('API key saved successfully', 'success');
    } catch (e) {
      showToast('Failed to save API key', 'error');
    } finally {
      elSaveApiKeyBtn.disabled = false;
      elSaveApiKeyBtn.textContent = 'Save';
    }
  }

  async function testApiKey() {
    const key = currentSettings.apiKey || elApiKeyInput.value.trim();
    if (!key) {
      showTestResult('No API key to test. Save a key first.', 'error');
      return;
    }

    elTestApiKeyBtn.disabled = true;
    elTestApiKeyBtn.textContent = 'Testing...';
    showTestResult('Sending test request to Anthropic API...', 'loading');

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Say "ok"' }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || 'Response received';
        showTestResult('Connection successful. Response: "' + text.trim() + '"', 'success');
      } else {
        const errorBody = await response.text();
        let errorMsg = 'API error ' + response.status;
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed.error?.message || errorMsg;
        } catch (e) { /* use default */ }
        showTestResult('Connection failed: ' + errorMsg, 'error');
      }
    } catch (e) {
      showTestResult('Network error: ' + (e.message || 'Could not reach Anthropic API'), 'error');
    } finally {
      elTestApiKeyBtn.disabled = false;
      elTestApiKeyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Test Connection';
    }
  }

  function showTestResult(message, type) {
    elTestResult.textContent = message;
    elTestResult.className = 'test-result ' + type;
  }

  // ─── Actions: General Settings ───────────────────────────────

  async function saveGeneralSettings() {
    try {
      const settings = {
        model: currentSettings.model,
        maxTokens: currentSettings.maxTokens,
        theme: currentSettings.theme,
        autoAttachCdp: currentSettings.autoAttachCdp,
      };

      await sendMessage({
        type: 'SET_SETTINGS',
        ...settings,
      }).catch(() => null);

      await storageSet(settings);
    } catch (e) {
      showToast('Failed to save settings', 'error');
    }
  }

  function debounceSaveGeneralSettings() {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      saveGeneralSettings();
      showToast('Max tokens updated to ' + currentSettings.maxTokens, 'success');
    }, 400);
  }

  // ─── Actions: Hostnames ──────────────────────────────────────

  async function addHostname() {
    let hostname = elHostnameInput.value.trim().toLowerCase();

    if (!hostname) {
      showToast('Please enter a hostname', 'error');
      return;
    }

    // Strip protocol and paths if user entered a URL
    try {
      if (hostname.includes('://')) {
        hostname = new URL(hostname).hostname;
      } else if (hostname.includes('/')) {
        hostname = hostname.split('/')[0];
      }
    } catch (e) {
      // keep as-is
    }

    // Remove leading www. for consistency
    hostname = hostname.replace(/^www\./, '');

    // Basic hostname validation
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\.[a-z]{2,})?$/.test(hostname)) {
      showToast('Invalid hostname format', 'error');
      return;
    }

    if (currentSettings.disabledHostnames.includes(hostname)) {
      showToast(hostname + ' is already in the list', 'info');
      elHostnameInput.value = '';
      return;
    }

    currentSettings.disabledHostnames.push(hostname);
    await saveDisabledHostnames();
    renderHostnameList();
    elHostnameInput.value = '';
    showToast(hostname + ' added to disabled list', 'success');
  }

  async function removeHostname(hostname) {
    currentSettings.disabledHostnames = currentSettings.disabledHostnames.filter((h) => h !== hostname);
    await saveDisabledHostnames();
    renderHostnameList();
    showToast(hostname + ' removed', 'success');
  }

  async function clearAllHostnames() {
    if (!confirm('Remove all disabled hostnames? The extension will be active on all sites.')) {
      return;
    }

    currentSettings.disabledHostnames = [];
    await saveDisabledHostnames();
    renderHostnameList();
    showToast('All disabled hostnames cleared', 'success');
  }

  async function saveDisabledHostnames() {
    try {
      await sendMessage({
        type: 'SET_DISABLED_URLS',
        disabledUrls: currentSettings.disabledHostnames,
      }).catch(() => null);

      await storageSet({ disabledHostnames: currentSettings.disabledHostnames });
    } catch (e) {
      showToast('Failed to save hostname list', 'error');
    }
  }

  // ─── Actions: Reset All ──────────────────────────────────────

  async function resetAll() {
    if (!confirm('Are you sure you want to reset ALL settings? This will remove your API key, bridge config, and all preferences. This cannot be undone.')) {
      return;
    }

    if (!confirm('This is your last chance. All data will be permanently deleted. Continue?')) {
      return;
    }

    try {
      await sendMessage({ type: 'RESET_ALL' }).catch(() => null);
      await storageClearAll();

      currentSettings = { ...DEFAULTS };
      renderAuthSource();
      renderBridgeStatus();
      renderApiKeyStatus();
      renderGeneralSettings();
      renderHostnameList();

      // Clear test results
      elTestResult.className = 'test-result';
      elTestResult.textContent = '';
      elBridgeTestResult.className = 'test-result';
      elBridgeTestResult.textContent = '';

      showToast('All settings have been reset', 'success');
    } catch (e) {
      showToast('Failed to reset settings', 'error');
    }
  }

  // ─── Toast ───────────────────────────────────────────────────

  function showToast(message, type) {
    clearTimeout(toastTimer);

    elToast.textContent = message;
    elToast.className = 'toast ' + type;

    // Force reflow before adding visible class
    void elToast.offsetWidth;
    elToast.classList.add('visible');

    toastTimer = setTimeout(() => {
      elToast.classList.remove('visible');
    }, 3000);
  }
})();
