// options.js — AI Web Assistant Settings Page

(function () {
  'use strict';

  const DEFAULTS = {
    model: 'claude-opus-4-6',
    theme: 'dark',
    devMode: false,
  };

  const $ = (sel) => document.querySelector(sel);

  const elExtVersion = $('#ext-version');
  const elDevMode = $('#dev-mode-toggle');
  const elDevUserGroup = $('#dev-user-group');
  const elDevUserSelect = $('#dev-user-select');
  const elModelSelect = $('#model-select');
  const elThemeSelect = $('#theme-select');
  const elResetAllBtn = $('#reset-all-btn');
  const elToast = $('#toast');

  let currentSettings = { ...DEFAULTS };
  let toastTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setVersion();
    loadSettings().then(renderSettings);
    bindEvents();
  }

  function setVersion() {
    let version = '1.0.0';
    try {
      if (chrome && chrome.runtime && chrome.runtime.getManifest) {
        version = chrome.runtime.getManifest().version;
      }
    } catch (e) {}
    elExtVersion.textContent = version;
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
      chrome.runtime.sendMessage(msg, (response) => resolve(response));
    });
  }

  // ─── Load Settings ───────────────────────────────────────────

  async function loadSettings() {
    try {
      const [settingsResult, storageResult] = await Promise.all([
        sendMessage({ type: 'GET_SETTINGS' }).catch(() => null),
        storageGet(['model', 'theme', 'devMode']),
      ]);

      if (settingsResult && settingsResult.model !== undefined) {
        currentSettings.model = settingsResult.model || DEFAULTS.model;
        currentSettings.theme = settingsResult.theme || DEFAULTS.theme;
      } else {
        currentSettings.model = storageResult.model || DEFAULTS.model;
        currentSettings.theme = storageResult.theme || DEFAULTS.theme;
      }
      currentSettings.devMode = storageResult.devMode === true;
      currentSettings.devUser = storageResult.devUser || 'pars5555@yahoo.com|admin123';
    } catch (e) {
      const storageResult = await storageGet(['model', 'theme', 'devMode', 'devUser']);
      currentSettings.model = storageResult.model || DEFAULTS.model;
      currentSettings.theme = storageResult.theme || DEFAULTS.theme;
      currentSettings.devMode = storageResult.devMode === true;
      currentSettings.devUser = storageResult.devUser || 'pars5555@yahoo.com|admin123';
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  function renderSettings() {
    elDevMode.checked = currentSettings.devMode;
    elDevUserGroup.style.display = currentSettings.devMode ? '' : 'none';
    elDevUserSelect.value = currentSettings.devUser;
    elModelSelect.value = currentSettings.model;
    elThemeSelect.value = currentSettings.theme;
    applyTheme(currentSettings.theme);
  }

  function applyTheme(theme) {
    document.body.classList.remove('light');
    if (theme === 'light') document.body.classList.add('light');
  }

  // ─── Bind Events ─────────────────────────────────────────────

  function bindEvents() {
    elDevMode.addEventListener('change', () => {
      currentSettings.devMode = elDevMode.checked;
      elDevUserGroup.style.display = currentSettings.devMode ? '' : 'none';
      storageSet({ devMode: currentSettings.devMode });
      showToast(currentSettings.devMode ? 'Dev mode ON — using localhost:3466' : 'Dev mode OFF — using production', 'success');
    });

    elDevUserSelect.addEventListener('change', () => {
      currentSettings.devUser = elDevUserSelect.value;
      storageSet({ devUser: currentSettings.devUser });
      showToast('Dev user changed — reload sidepanel to apply', 'success');
    });

    elModelSelect.addEventListener('change', () => {
      currentSettings.model = elModelSelect.value;
      saveSettings();
      showToast('Model updated', 'success');
    });

    elThemeSelect.addEventListener('change', () => {
      currentSettings.theme = elThemeSelect.value;
      applyTheme(currentSettings.theme);
      saveSettings();
      showToast('Theme updated', 'success');
    });

    elResetAllBtn.addEventListener('click', resetAll);
  }

  // ─── Save ────────────────────────────────────────────────────

  async function saveSettings() {
    try {
      await sendMessage({
        type: 'SET_SETTINGS',
        model: currentSettings.model,
        theme: currentSettings.theme,
      }).catch(() => null);

      await storageSet(currentSettings);
    } catch (e) {
      showToast('Failed to save settings', 'error');
    }
  }

  // ─── Reset All ───────────────────────────────────────────────

  async function resetAll() {
    if (!confirm('Are you sure you want to reset ALL settings? This cannot be undone.')) return;

    try {
      await sendMessage({ type: 'RESET_ALL' }).catch(() => null);
      await storageClearAll();
      currentSettings = { ...DEFAULTS };
      renderSettings();
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
    void elToast.offsetWidth;
    elToast.classList.add('visible');
    toastTimer = setTimeout(() => { elToast.classList.remove('visible'); }, 3000);
  }
})();
