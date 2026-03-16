#!/usr/bin/env node
// bridge.js — Local bridge server connecting Chrome Extension to Claude Code CLI
// Usage: node bridge.js [--port 3456]

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 3456;
const CORS_ORIGIN = '*'; // Chrome extensions send Origin: chrome-extension://...

// Parse CLI args
const args = process.argv.slice(2);
let port = DEFAULT_PORT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

// ─── Active Sessions ─────────────────────────────────────────────────────────

const sessions = new Map(); // sessionId → { process, alive }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(res, status, data, req) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(req) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ─── Check Claude Code is installed and authenticated ────────────────────────

async function checkClaudeCode() {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], {
      shell: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.stderr.on('data', (d) => (output += d.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({ ok: false, error: 'Claude Code exited with code ' + code });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: 'Claude Code not found: ' + err.message });
    });
  });
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  // ── Health check ──
  if (path === '/health' && req.method === 'GET') {
    const status = await checkClaudeCode();
    return jsonResponse(res, 200, {
      status: 'ok',
      bridge: 'Claude Web Assistant Bridge',
      claude: status,
    }, req);
  }

  // ── Chat (streaming SSE) ──
  if (path === '/chat' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return jsonResponse(res, 400, { error: 'Invalid JSON body' }, req);
    }

    const { message, model, maxTokens, systemPrompt } = body;
    if (!message) {
      return jsonResponse(res, 400, { error: 'Missing "message" field' }, req);
    }

    // Build claude CLI args
    const cliArgs = [
      '-p',                           // print mode (non-interactive)
      '--output-format', 'stream-json', // streaming JSON output
      '--verbose',                    // required for stream-json
      '--no-session-persistence',     // don't save session
    ];

    if (model) {
      cliArgs.push('--model', model);
    }

    if (systemPrompt) {
      cliArgs.push('--system-prompt', systemPrompt);
    }

    // The prompt MUST be the last argument
    cliArgs.push(message);

    // Set up SSE response
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders(req),
    };
    res.writeHead(200, sseHeaders);

    // Spawn Claude Code
    const proc = spawn('claude', cliArgs, {
      shell: true,
      env: {
        ...process.env,
        // Unset CLAUDECODE to avoid "nested session" error
        CLAUDECODE: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let fullText = '';
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // Claude Code stream-json --verbose format:
          // { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
          // { type: "result", result: "full text", ... }
          if (event.type === 'assistant' && event.message) {
            const content = event.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  fullText += block.text;
                  res.write(`data: ${JSON.stringify({ type: 'delta', text: block.text })}\n\n`);
                }
              }
            }
          } else if (event.type === 'assistant' && event.content) {
            fullText += event.content;
            res.write(`data: ${JSON.stringify({ type: 'delta', text: event.content })}\n\n`);
          } else if (event.type === 'result') {
            if (event.result) {
              if (!fullText) {
                fullText = event.result;
                res.write(`data: ${JSON.stringify({ type: 'delta', text: fullText })}\n\n`);
              }
            }
            res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
          } else if (event.type === 'error') {
            res.write(`data: ${JSON.stringify({ type: 'error', error: event.error?.message || event.content || 'Unknown error' })}\n\n`);
          }
        } catch (e) {
          // Not JSON — might be raw text output, send as delta
          if (trimmed) {
            fullText += trimmed;
            res.write(`data: ${JSON.stringify({ type: 'delta', text: trimmed })}\n\n`);
          }
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const errText = chunk.toString().trim();
      // Filter out common non-error stderr messages
      if (errText && !errText.includes('ExperimentalWarning')) {
        console.error('[claude stderr]', errText);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0 && !fullText) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Claude Code exited with code ' + code })}\n\n`);
      }
      // Always send done if not already sent
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();
    });

    proc.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to start Claude Code: ' + err.message })}\n\n`);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    });

    return;
  }

  // ── Chat with conversation history (interactive session) ──
  if (path === '/chat/session' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return jsonResponse(res, 400, { error: 'Invalid JSON body' }, req);
    }

    const { message, sessionId, model, maxTokens, systemPrompt } = body;
    if (!message) {
      return jsonResponse(res, 400, { error: 'Missing "message" field' }, req);
    }

    // Build claude CLI args for stream-json input/output (bidirectional streaming)
    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      '--no-session-persistence',
    ];

    if (model) cliArgs.push('--model', model);
    if (systemPrompt) cliArgs.push('--system-prompt', systemPrompt);

    // Set up SSE response
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders(req),
    };
    res.writeHead(200, sseHeaders);

    const proc = spawn('claude', cliArgs, {
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let fullText = '';
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'assistant' && event.content) {
            fullText += event.content;
            res.write(`data: ${JSON.stringify({ type: 'delta', text: event.content })}\n\n`);
          } else if (event.type === 'result') {
            if (event.content && !fullText) {
              fullText = event.content;
              res.write(`data: ${JSON.stringify({ type: 'delta', text: fullText })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ type: 'done', fullText, sessionId: event.session_id })}\n\n`);
          } else if (event.type === 'error') {
            res.write(`data: ${JSON.stringify({ type: 'error', error: event.error?.message || event.content || 'Unknown error' })}\n\n`);
          }
        } catch (e) {
          if (trimmed) {
            fullText += trimmed;
            res.write(`data: ${JSON.stringify({ type: 'delta', text: trimmed })}\n\n`);
          }
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const errText = chunk.toString().trim();
      if (errText && !errText.includes('ExperimentalWarning')) {
        console.error('[claude stderr]', errText);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0 && !fullText) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Claude Code exited with code ' + code })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();
    });

    proc.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to start Claude Code: ' + err.message })}\n\n`);
      res.end();
    });

    // Send the message via stdin as stream-json
    const inputMsg = JSON.stringify({ type: 'user', content: message }) + '\n';
    proc.stdin.write(inputMsg);
    proc.stdin.end();

    req.on('close', () => {
      if (!proc.killed) proc.kill('SIGTERM');
    });

    return;
  }

  // ── 404 ──
  jsonResponse(res, 404, { error: 'Not found. Available endpoints: GET /health, POST /chat' }, req);
});

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(port, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║    Claude Web Assistant — Bridge Server          ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  URL:  http://127.0.0.1:${port}                    ║`);
  console.log('  ║  Endpoints:                                     ║');
  console.log('  ║    GET  /health    — Check status                ║');
  console.log('  ║    POST /chat      — Send message (SSE stream)   ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║  Press Ctrl+C to stop                           ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  // Check Claude Code on startup
  checkClaudeCode().then((status) => {
    if (status.ok) {
      console.log('  ✓ Claude Code detected:', status.version);
    } else {
      console.error('  ✗ Claude Code not found:', status.error);
      console.error('    Install: https://docs.anthropic.com/en/docs/claude-code');
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try: node bridge.js --port ${port + 1}`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
