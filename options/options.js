// options.js — AI Web Assistant Settings Page

(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────

  const DEFAULTS = {
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    theme: 'dark',
    autoAttachCdp: false,
    disabledHostnames: [],
  };

  // ─── DOM References ──────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);

  // Version
  const elExtVersion = $('#ext-version');

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

  // Reset
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
      const [settingsResult, urlsResult, storageResult] = await Promise.all([
        sendMessage({ type: 'GET_SETTINGS' }).catch(() => null),
        sendMessage({ type: 'GET_DISABLED_URLS' }).catch(() => null),
        storageGet(['model', 'maxTokens', 'theme', 'autoAttachCdp', 'disabledHostnames']),
      ]);

      if (settingsResult && settingsResult.model !== undefined) {
        currentSettings.model = settingsResult.model || DEFAULTS.model;
        currentSettings.maxTokens = settingsResult.maxTokens || DEFAULTS.maxTokens;
        currentSettings.autoAttachCdp = settingsResult.autoAttachCdp === true;
        currentSettings.theme = settingsResult.theme || DEFAULTS.theme;
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
    if (!confirm('Are you sure you want to reset ALL settings? This will remove all preferences. This cannot be undone.')) {
      return;
    }

    try {
      await sendMessage({ type: 'RESET_ALL' }).catch(() => null);
      await storageClearAll();

      currentSettings = { ...DEFAULTS };
      renderGeneralSettings();
      renderHostnameList();

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
