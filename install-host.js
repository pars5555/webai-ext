#!/usr/bin/env node
// install-host.js — Register the native messaging host for Claude Web Assistant
//
// Usage:
//   node install-host.js                           # auto-detect extension ID
//   node install-host.js --extension-id <id>       # specify extension ID
//   node install-host.js --uninstall               # remove registration
//
// This script:
//   1. Creates a native messaging host manifest pointing to host.js
//   2. On Windows: adds a registry key
//   3. On macOS/Linux: copies manifest to the correct directory

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const HOST_NAME = 'com.claude.web_assistant';
const HOST_SCRIPT = path.resolve(__dirname, 'native-host', 'host.js');

// Parse args
const args = process.argv.slice(2);
let extensionId = null;
let uninstall = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--extension-id' && args[i + 1]) {
    extensionId = args[i + 1];
    i++;
  } else if (args[i] === '--uninstall') {
    uninstall = true;
  }
}

// ─── Detect Node.js path ─────────────────────────────────────────────────────

function getNodePath() {
  try {
    if (process.platform === 'win32') {
      return execSync('where node', { encoding: 'utf8' }).trim().split('\n')[0].trim();
    } else {
      return execSync('which node', { encoding: 'utf8' }).trim();
    }
  } catch (e) {
    return process.execPath;
  }
}

// ─── Create batch/shell wrapper ──────────────────────────────────────────────

function createWrapper() {
  const nodePath = getNodePath();

  if (process.platform === 'win32') {
    // Windows: create a .bat wrapper
    const batPath = path.resolve(__dirname, 'native-host', 'host.bat');
    const batContent = `@echo off\r\n"${nodePath}" "${HOST_SCRIPT}"\r\n`;
    fs.writeFileSync(batPath, batContent);
    return batPath;
  } else {
    // macOS/Linux: create a shell wrapper
    const shPath = path.resolve(__dirname, 'native-host', 'host.sh');
    const shContent = `#!/bin/bash\nexec "${nodePath}" "${HOST_SCRIPT}"\n`;
    fs.writeFileSync(shPath, shContent, { mode: 0o755 });
    return shPath;
  }
}

// ─── Create native messaging manifest ────────────────────────────────────────

function createManifest(wrapperPath, extId) {
  const manifest = {
    name: HOST_NAME,
    description: 'Claude Web Assistant — Native messaging host bridging to Claude Code CLI',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${extId}/`
    ],
  };
  return manifest;
}

// ─── Platform-specific install ───────────────────────────────────────────────

function installWindows(manifest) {
  // Write manifest JSON
  const manifestDir = path.resolve(__dirname, 'native-host');
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Add registry key
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const manifestPathWin = manifestPath.replace(/\//g, '\\');

  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPathWin}" /f`, {
      stdio: 'pipe',
    });
    console.log('  Registry key added:', regKey);
  } catch (e) {
    console.error('  Failed to add registry key. Try running as Administrator.');
    console.error('  Or manually add this registry key:');
    console.error(`    ${regKey} = ${manifestPathWin}`);
    return false;
  }

  console.log('  Manifest written to:', manifestPath);
  return true;
}

function installMacOS(manifest) {
  const targetDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  const manifestPath = path.join(targetDir, `${HOST_NAME}.json`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('  Manifest written to:', manifestPath);
  return true;
}

function installLinux(manifest) {
  const targetDir = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  const manifestPath = path.join(targetDir, `${HOST_NAME}.json`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('  Manifest written to:', manifestPath);
  return true;
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

function uninstallHost() {
  console.log('\n  Uninstalling native messaging host...\n');

  if (process.platform === 'win32') {
    const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    try {
      execSync(`reg delete "${regKey}" /f`, { stdio: 'pipe' });
      console.log('  Registry key removed:', regKey);
    } catch (e) {
      console.log('  Registry key not found (already removed)');
    }
  } else if (process.platform === 'darwin') {
    const manifestPath = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    try { fs.unlinkSync(manifestPath); } catch (e) { /* ok */ }
    console.log('  Manifest removed');
  } else {
    const manifestPath = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    try { fs.unlinkSync(manifestPath); } catch (e) { /* ok */ }
    console.log('  Manifest removed');
  }

  // Remove wrapper scripts
  const batPath = path.resolve(__dirname, 'native-host', 'host.bat');
  const shPath = path.resolve(__dirname, 'native-host', 'host.sh');
  try { fs.unlinkSync(batPath); } catch (e) { /* ok */ }
  try { fs.unlinkSync(shPath); } catch (e) { /* ok */ }

  console.log('\n  Done! Native messaging host uninstalled.\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║  Claude Web Assistant — Native Host Installer    ║');
  console.log('  ╚══════════════════════════════════════════════════╝');

  if (uninstall) {
    uninstallHost();
    return;
  }

  if (!extensionId) {
    console.log('');
    console.log('  To find your extension ID:');
    console.log('    1. Go to chrome://extensions/');
    console.log('    2. Enable Developer mode');
    console.log('    3. Find "Claude Web Assistant"');
    console.log('    4. Copy the ID (e.g., abcdefghijklmnopqrstuvwxyz)');
    console.log('');
    console.log('  Then run:');
    console.log('    node install-host.js --extension-id YOUR_EXTENSION_ID');
    console.log('');

    // Try reading from stdin
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question('  Enter your extension ID: ', (answer) => {
      rl.close();
      const id = answer.trim();
      if (!id || id.length < 10) {
        console.error('  Invalid extension ID');
        process.exit(1);
      }
      install(id);
    });
    return;
  }

  install(extensionId);
}

function install(extId) {
  console.log('');
  console.log('  Extension ID:', extId);
  console.log('  Platform:', process.platform);
  console.log('');

  // Verify host.js exists
  if (!fs.existsSync(HOST_SCRIPT)) {
    console.error('  Error: host.js not found at:', HOST_SCRIPT);
    process.exit(1);
  }

  // Create wrapper
  const wrapperPath = createWrapper();
  console.log('  Wrapper created:', wrapperPath);

  // Create manifest
  const manifest = createManifest(wrapperPath, extId);

  // Platform-specific install
  let ok = false;
  if (process.platform === 'win32') {
    ok = installWindows(manifest);
  } else if (process.platform === 'darwin') {
    ok = installMacOS(manifest);
  } else {
    ok = installLinux(manifest);
  }

  if (ok) {
    console.log('');
    console.log('  Installation complete!');
    console.log('');
    console.log('  Next steps:');
    console.log('    1. Make sure Claude Code is installed and logged in (claude login)');
    console.log('    2. Restart Chrome');
    console.log('    3. The extension will auto-connect to Claude Code');
    console.log('');
  }
}

main();
