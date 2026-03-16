#!/usr/bin/env node
// host.js — Native Messaging host for Claude Web Assistant
// Chrome launches this process automatically via native messaging.
// Communication is via stdin/stdout using Chrome's native messaging protocol:
//   Each message is prefixed with a 4-byte (uint32 LE) length header.
//
// Each chat message spawns `claude -p` per request. Conversation persistence
// is handled via --session-id (first message) and --resume (subsequent messages),
// so Claude Code manages conversation history internally.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Logging ─────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(__dirname, 'host.log');

function log(...args) {
  const timestamp = new Date().toISOString();
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
}

log('=== Native host started ===');
log('Node version:', process.version);
log('Platform:', process.platform);
log('CWD:', process.cwd());

// ─── Native Messaging I/O ────────────────────────────────────────────────────

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInput();
});

process.stdin.on('end', () => {
  log('stdin ended, exiting');
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGTERM');
  }
  process.exit(0);
});

function processInput() {
  while (inputBuffer.length >= 4) {
    const msgLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLength) break;

    const msgBytes = inputBuffer.slice(4, 4 + msgLength);
    inputBuffer = inputBuffer.slice(4 + msgLength);

    try {
      const message = JSON.parse(msgBytes.toString('utf8'));
      log('Received:', message.type, message.id || '');
      handleMessage(message);
    } catch (e) {
      log('Parse error:', e.message);
      sendMessage({ type: 'error', error: 'Invalid JSON: ' + e.message });
    }
  }
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buffer = Buffer.alloc(4 + Buffer.byteLength(json, 'utf8'));
  buffer.writeUInt32LE(Buffer.byteLength(json, 'utf8'), 0);
  buffer.write(json, 4, 'utf8');

  try {
    process.stdout.write(buffer);
  } catch (e) {
    log('Failed to send message:', e.message);
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleMessage(message) {
  switch (message.type) {
    case 'health':
      handleHealthCheck();
      break;

    case 'chat':
      handleChat(message);
      break;

    case 'cancel':
      handleCancel();
      break;

    case 'ping':
      sendMessage({ type: 'pong' });
      break;

    default:
      log('Unknown message type:', message.type);
      sendMessage({ type: 'error', error: 'Unknown message type: ' + message.type });
  }
}

// ─── Health Check ────────────────────────────────────────────────────────────

function handleHealthCheck() {
  log('Health check...');

  const proc = spawn('claude', ['--version'], {
    shell: true,
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', (d) => (output += d.toString()));
  proc.stderr.on('data', (d) => (output += d.toString()));

  proc.on('close', (code) => {
    log('Health check result:', code === 0 ? 'OK' : 'FAIL', output.trim());
    sendMessage({
      type: 'health_result',
      ok: code === 0,
      version: output.trim(),
    });
  });

  proc.on('error', (err) => {
    log('Health check error:', err.message);
    sendMessage({
      type: 'health_result',
      ok: false,
      error: 'Claude Code not found: ' + err.message,
    });
  });
}

// ─── One-Shot Chat with Session Persistence ──────────────────────────────────
// Each message spawns `claude -p`. Conversation continuity is achieved via
// --session-id (first message) and --resume (subsequent messages).
// Claude Code saves/loads conversation history automatically.

let activeProcess = null;

function handleChat(message) {
  const { id, prompt, model, systemPrompt, sessionId, isResume } = message;

  log('Chat request:', id, 'model:', model, 'sessionId:', sessionId || 'none', 'isResume:', !!isResume, 'prompt length:', prompt?.length);

  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGTERM');
  }

  const cliArgs = ['-p', '--output-format', 'stream-json', '--verbose'];

  // Session persistence: --session-id for first msg, --resume for subsequent
  if (sessionId && isResume) {
    cliArgs.push('--resume', sessionId);
  } else if (sessionId) {
    cliArgs.push('--session-id', sessionId);
  } else {
    cliArgs.push('--no-session-persistence');
  }

  if (model) cliArgs.push('--model', model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  log('Spawning claude with args:', cliArgs.join(' '), '| prompt via stdin, length:', prompt?.length);

  const proc = spawn('claude', cliArgs, {
    shell: true,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Embed system prompt in stdin content (not CLI arg — shell escaping breaks it on Windows)
  // Only embed on first message; --resume remembers the context from the session.
  let fullPrompt = prompt;
  if (systemPrompt && !isResume) {
    fullPrompt = `<context>\n${systemPrompt}\n</context>\n\n${prompt}`;
    log('Prompt includes system prompt, total stdin length:', fullPrompt.length);
  }

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  activeProcess = proc;
  let fullText = '';
  let buffer = '';
  let sentEnd = false;

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);

        if (event.type === 'assistant' && event.message) {
          const content = event.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
                sendMessage({ type: 'stream_delta', id, text: block.text });
              }
            }
          }
        } else if (event.type === 'assistant' && event.content) {
          fullText += event.content;
          sendMessage({ type: 'stream_delta', id, text: event.content });
        } else if (event.type === 'result') {
          if (event.result && !fullText) {
            fullText = event.result;
            sendMessage({ type: 'stream_delta', id, text: fullText });
          }
          if (!sentEnd) {
            sentEnd = true;
            sendMessage({ type: 'stream_end', id, fullText });
          }
          log('Chat complete:', id, 'length:', fullText.length);
        } else if (event.type === 'error') {
          log('Claude error event:', event);
          sendMessage({
            type: 'stream_error',
            id,
            error: event.error?.message || event.content || 'Unknown error',
          });
        }
      } catch (e) {
        if (trimmed && !trimmed.startsWith('{')) {
          fullText += trimmed + '\n';
          sendMessage({ type: 'stream_delta', id, text: trimmed + '\n' });
        }
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const errText = chunk.toString().trim();
    if (errText) log('Claude stderr:', errText);
  });

  proc.on('close', (code) => {
    log('Claude process exited code:', code);
    if (code !== 0 && !fullText && !sentEnd) {
      sendMessage({
        type: 'stream_error',
        id,
        error: 'Claude Code exited with code ' + code + '. Check native-host/host.log for details.',
      });
    }
    if (!sentEnd) {
      sentEnd = true;
      sendMessage({ type: 'stream_end', id, fullText });
    }
    activeProcess = null;
  });

  proc.on('error', (err) => {
    log('Spawn error:', err.message);
    sendMessage({ type: 'stream_error', id, error: 'Failed to start Claude Code: ' + err.message });
    activeProcess = null;
  });
}

// ─── Persistent Session Chat (EXPERIMENTAL — NOT YET WORKING) ────────────────
// TODO: Fix this. The goal is to keep one `claude` process alive per session
// using --input-format stream-json, so we don't spawn a new process per message.
//
// KNOWN ISSUE: `claude -p --input-format stream-json` buffers ALL stdin until
// EOF before processing. The process never starts generating a response while
// stdin is open. Without `-p`, Claude tries TUI mode which doesn't work with
// piped stdio. We need to find a way to either:
//   1. Signal "end of current message" without closing stdin (some delimiter?)
//   2. Use an undocumented flag or env var to enable true streaming input mode
//   3. Use the Claude Agent SDK (Node.js) instead of the CLI for persistent sessions
//
// The code below is structurally complete but disabled because of the stdin
// buffering issue. Uncomment and fix when a solution is found.
//
// To enable: add 'session_start', 'session_message', 'session_end' cases to
// handleMessage() switch, and update background.js to send those message types.

const sessions = new Map(); // sessionId → { proc, buffer, currentMsgId, fullText, sentEnd, alive }

function handleSessionStart(message) {
  const { sessionId, model, systemPrompt } = message;

  log('Session start:', sessionId, 'model:', model);

  if (sessions.has(sessionId)) {
    killSession(sessionId, 'replaced by new session');
  }

  const cliArgs = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
  ];
  if (model) cliArgs.push('--model', model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  log('Spawning persistent claude:', cliArgs.join(' '));

  const proc = spawn('claude', cliArgs, {
    shell: true,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session = {
    proc,
    buffer: '',
    currentMsgId: null,
    fullText: '',
    sentEnd: false,
    systemPrompt: systemPrompt || '',
    firstMessage: true,
    alive: true,
  };

  sessions.set(sessionId, session);

  proc.stdout.on('data', (chunk) => {
    if (!session.alive) return;
    session.buffer += chunk.toString();

    const lines = session.buffer.split('\n');
    session.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const id = session.currentMsgId;

        if (!id) {
          log('Session [' + sessionId + '] output without active msg:', trimmed.substring(0, 80));
          continue;
        }

        if (event.type === 'assistant' && event.message) {
          const content = event.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                session.fullText += block.text;
                sendMessage({ type: 'stream_delta', id, text: block.text });
              }
            }
          }
        } else if (event.type === 'assistant' && event.content) {
          session.fullText += event.content;
          sendMessage({ type: 'stream_delta', id, text: event.content });
        } else if (event.type === 'result') {
          if (event.result && !session.fullText) {
            session.fullText = event.result;
            sendMessage({ type: 'stream_delta', id, text: session.fullText });
          }
          if (!session.sentEnd) {
            session.sentEnd = true;
            sendMessage({ type: 'stream_end', id, fullText: session.fullText, sessionId });
          }
          log('Session response complete [' + sessionId + ']:', id, 'length:', session.fullText.length);
          session.currentMsgId = null;
          session.fullText = '';
          session.sentEnd = false;
        } else if (event.type === 'error') {
          log('Claude error [' + sessionId + ']:', event);
          sendMessage({
            type: 'stream_error',
            id,
            error: event.error?.message || event.content || 'Unknown error',
          });
        }
      } catch (e) {
        log('Session [' + sessionId + '] non-JSON:', trimmed.substring(0, 100));
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const errText = chunk.toString().trim();
    if (errText) log('Claude stderr [' + sessionId + ']:', errText);
  });

  proc.on('close', (code) => {
    log('Claude process closed [' + sessionId + '] code:', code);
    session.alive = false;

    if (session.currentMsgId && !session.sentEnd) {
      if (code !== 0 && !session.fullText) {
        sendMessage({ type: 'stream_error', id: session.currentMsgId, error: 'Claude exited with code ' + code });
      }
      sendMessage({ type: 'stream_end', id: session.currentMsgId, fullText: session.fullText, sessionId });
    }

    sessions.delete(sessionId);
    sendMessage({ type: 'session_ended', sessionId, code });
  });

  proc.on('error', (err) => {
    log('Claude spawn error [' + sessionId + ']:', err.message);
    session.alive = false;
    sendMessage({ type: 'session_error', sessionId, error: 'Failed to start Claude: ' + err.message });
    sessions.delete(sessionId);
  });

  sendMessage({ type: 'session_started', sessionId });
}

function handleSessionMessage(message) {
  const { sessionId, id, prompt, systemPrompt } = message;

  const session = sessions.get(sessionId);
  if (!session || !session.alive) {
    log('Session not found or dead:', sessionId);
    sendMessage({ type: 'stream_error', id, error: 'Session not found: ' + sessionId });
    return;
  }

  if (session.currentMsgId) {
    log('WARN: Session [' + sessionId + '] already processing:', session.currentMsgId, '— new message:', id);
  }

  session.currentMsgId = id;
  session.fullText = '';
  session.sentEnd = false;

  let content = prompt;

  if (session.firstMessage && (systemPrompt || session.systemPrompt)) {
    const sp = systemPrompt || session.systemPrompt;
    content = `<context>\n${sp}\n</context>\n\n${prompt}`;
    session.firstMessage = false;
    log('Session message [' + sessionId + ']:', id, '(with system prompt) content_len:', content.length);
  } else {
    log('Session message [' + sessionId + ']:', id, 'content_len:', content.length);
  }

  const inputMsg = JSON.stringify({ message: { role: 'user', content } }) + '\n';

  try {
    session.proc.stdin.write(inputMsg);
  } catch (e) {
    log('Failed to write to session stdin [' + sessionId + ']:', e.message);
    sendMessage({ type: 'stream_error', id, error: 'Session write failed: ' + e.message });
    session.alive = false;
  }
}

function handleSessionEnd(message) {
  killSession(message.sessionId, 'client requested end');
}

function killSession(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;

  log('Killing session:', sessionId, 'reason:', reason);
  session.alive = false;

  try {
    if (session.proc && !session.proc.killed) {
      session.proc.stdin.end();
      session.proc.kill('SIGTERM');
    }
  } catch (e) {
    log('Error killing session process:', e.message);
  }

  sessions.delete(sessionId);
  sendMessage({ type: 'session_ended', sessionId });
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

function handleCancel() {
  log('Cancel requested');
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGTERM');
    activeProcess = null;
    sendMessage({ type: 'cancelled' });
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  log('SIGTERM received');
  if (activeProcess && !activeProcess.killed) activeProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received');
  if (activeProcess && !activeProcess.killed) activeProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log('Uncaught exception:', err.message, err.stack);
  if (activeProcess && !activeProcess.killed) activeProcess.kill('SIGTERM');
  process.exit(1);
});
