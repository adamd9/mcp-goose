import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import path from 'node:path';

import { config, validateConfig } from './config.js';
import { startJob, jobStatus, streamLogs, getOutput, stopJob, getRunningJobId } from './jobs.js';
import fs from 'node:fs';
import { publishCurrentBranch, initGitWatcher, resolvePreviewRoot } from './publish.js';

dotenv.config();

// Instantiate MCP server BEFORE registering any tools
const server = new McpServer({ name: 'mcp-goose', version: '0.1.0' });

// Tool: goose_session_start
server.registerTool(
  'goose_session_start',
  {
    title: 'Session Start',
    description: 'Start an interactive Goose session (CLI)',
    inputSchema: {
      name: z.string().optional().describe('Optional session name (-n, --name)')
    }
  },
  async ({ name }) => {
    const args = ['session', '--with-builtin', 'developer'];
    if (name) args.push('--name', name);
    if (getRunningJobId()) {
      const err = new Error('A job is already running. Concurrency is limited to 1.');
      err.code = 'BUSY';
      throw err;
    }
    const { jobId, pid, startedAt } = startJob({
      command: args.shift(),
      args: sanitizeArgs(args),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_session_resume
server.registerTool(
  'goose_session_resume',
  {
    title: 'Session Resume',
    description: 'Resume an existing Goose session (CLI)',
    inputSchema: {
      name: z.string().optional().describe('Resume by name (-n, --name)'),
      id: z.string().optional().describe('Resume by id (-i, --id)')
    }
  },
  async ({ name, id }) => {
    const args = ['session', '--resume', '--with-builtin', 'developer'];
    if (name) args.push('--name', name);
    if (id) args.push('--id', id);
    if (getRunningJobId()) {
      const err = new Error('A job is already running. Concurrency is limited to 1.');
      err.code = 'BUSY';
      throw err;
    }
    const { jobId, pid, startedAt } = startJob({
      command: args.shift(),
      args: sanitizeArgs(args),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_session_remove
server.registerTool(
  'goose_session_remove',
  {
    title: 'Session Remove',
    description: 'Remove one or more saved sessions (irreversible)',
    inputSchema: {
      id: z.string().optional().describe('Remove by id (-i, --id)'),
      name: z.string().optional().describe('Remove by name (-n, --name)'),
      regex: z.string().optional().describe('Regex pattern (-r, --regex)')
    }
  },
  async ({ id, name, regex }) => {
    const args = ['session', 'remove'];
    if (id) args.push('--id', id);
    if (name) args.push('--name', name);
    if (regex) args.push('--regex', regex);
    if (getRunningJobId()) {
      const err = new Error('A job is already running. Concurrency is limited to 1.');
      err.code = 'BUSY';
      throw err;
    }
    const { jobId, pid, startedAt } = startJob({
      command: args.shift(),
      args: sanitizeArgs(args),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Validate config at startup
const configErrors = validateConfig();
if (configErrors.length) {
  console.error('[config] Invalid configuration:\n- ' + configErrors.join('\n- '));
  process.exit(1);
}

// Express app
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// Simple status route (not MCP)
app.get('/status', (req, res) => {
  res.json({
    name: 'mcp-goose',
    status: 'ok',
    timeUtc: new Date().toISOString(),
    scopeDir: config.scopeDir
  });
});

// Auth helper
function checkAuth(req, res) {
  const header = req.headers['authorization'] || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : header).trim();
  if (!token || token !== config.authToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Allowed commands and flags (based on local docs in ref-docs/documentation/docs/guides/goose-cli-commands.md)
const ALLOWED_COMMANDS = new Set(['run', 'recipe', 'info', 'version', 'help', 'session']);
const ALLOWED_FLAGS = new Set([
  // run (Task Execution)
  '--recipe', '--instructions', '-i', '--text', '-t', '--no-session', '--name', '-n', '--resume', '-r', '--path', '-p',
  '--max-turns', '--explain', '--debug', '--provider', '--model', '--params', '--sub-recipe', '--with-builtin',
  // session list/export (Session Management)
  '--verbose', '-v', '--format', '-f', '--ascending', '--id', '-n', '--name', '--path', '-p', '--output', '-o',
]);
const DISALLOWED_FLAGS = new Set(['--interactive', '-s']);

function sanitizeArgs(inputArgs = []) {
  // Reject any shell metacharacters and unknown flags
  const out = [];
  for (const a of inputArgs) {
    if (typeof a !== 'string') continue;
    if (/[`|;&<>$\\]/.test(a)) throw new Error(`unsafe token detected: ${a}`);
    if (a.startsWith('-')) {
      // Flags we accept; allow values to follow as separate args
      if (!ALLOWED_FLAGS.has(a)) throw new Error(`flag not allowed: ${a}`);
    }
    if (DISALLOWED_FLAGS.has(a)) throw new Error(`flag disallowed: ${a}`);
    out.push(a);
  }
  return out;
}

function buildRunArgs({ args = [], params = {} }) {
  const finalArgs = sanitizeArgs(args);
  // Expand params object into repeated --params key=value entries
  for (const [k, v] of Object.entries(params || {})) {
    if (!/^[A-Za-z0-9_.-]+$/.test(k)) throw new Error(`invalid param key: ${k}`);
    finalArgs.push('--params', `${k}=${String(v)}`);
  }
  // Enforce non-interactive by ensuring we did not receive -s/--interactive
  return finalArgs;
}

function ensureAllowedCommand(command) {
  if (!ALLOWED_COMMANDS.has(command)) throw new Error(`command not allowed: ${command}`);
}

// Tool: health_check
server.registerTool(
  'health_check',
  { title: 'Health Check', description: 'Liveness/readiness check', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, at: new Date().toISOString() }, null, 2) }] })
);

// Tool: get_config
server.registerTool(
  'get_config',
  { title: 'Get Config', description: 'Returns non-sensitive server configuration', inputSchema: {} },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({
      scopeDir: config.scopeDir,
      maxConcurrency: config.maxConcurrency,
      logMaxBytes: config.logMaxBytes,
      allowedCommands: Array.from(ALLOWED_COMMANDS)
    }, null, 2) }]
  })
);

// Tool: goose_version
server.registerTool(
  'goose_version',
  { title: 'Goose Version', description: 'Return goose --version', inputSchema: {} },
  async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(config.gooseBinary, ['--version'], { encoding: 'utf8' });
    if (r.error) throw r.error;
    return { content: [{ type: 'text', text: r.stdout.trim() || r.stderr.trim() }] };
  }
);

// Tool: goose_help
server.registerTool(
  'goose_help',
  {
    title: 'Goose Help',
    description: 'Return help text for Goose or a specific command',
    inputSchema: { command: z.string().optional().describe('Command to show help for') }
  },
  async ({ command }) => {
    const { spawnSync } = await import('node:child_process');
    const args = command ? [command, '--help'] : ['--help'];
    const r = spawnSync(config.gooseBinary, args, { encoding: 'utf8' });
    if (r.error) throw r.error;
    return { content: [{ type: 'text', text: r.stdout || r.stderr }] };
  }
);

// Tool: goose_list_commands
server.registerTool(
  'goose_list_commands',
  { title: 'Allowed Commands', description: 'List allowlisted Goose commands and flags', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: JSON.stringify({
    commands: Array.from(ALLOWED_COMMANDS),
    allowedFlags: Array.from(ALLOWED_FLAGS),
    disallowedFlags: Array.from(DISALLOWED_FLAGS)
  }, null, 2) }] })
);

// Tool: goose_run
server.registerTool(
  'goose_run',
  {
    title: 'Run Goose Command',
    description: "Start a Goose 'run' job with a text prompt (headless). Always runs '--no-session -t <text>'.",
    inputSchema: {
      text: z.string().min(1).describe('Natural language instruction to pass to goose run (-t)')
    }
  },
  async ({ text }) => {
    const normalized = 'run';
    ensureAllowedCommand(normalized);

    // Create a runtime recipe using local template if available
    const runtimeDir = path.join(config.scopeDir, '.mcp-goose', 'runtime-recipes');
    try { fs.mkdirSync(runtimeDir, { recursive: true }); } catch {}
    const recipePath = path.join(runtimeDir, `run-${Date.now()}.yaml`);
    const templatePath = path.resolve(process.cwd(), 'recipes', 'headless-run.yaml');
    let recipeYaml;
    try {
      if (fs.existsSync(templatePath)) {
        const tpl = fs.readFileSync(templatePath, 'utf8');
        recipeYaml = tpl.replace('<<<INSTRUCTION>>>', text);
      } else {
        // Fallback: synthesize a minimal recipe if template missing
        const prompt = `You are Goose running in headless mode. Follow the user instruction faithfully.\n\nUser instruction:\n${text}\n\nOperational requirements (perform automatically unless unsafe):\n- If the current directory is not a git repository, initialize one (git init).\n- Create and switch to a new feature branch uniquely named for this run (e.g., 'feat/mcp-run-<timestamp>').\n- Make all code changes on that branch.\n- At the end of the run, add all relevant files and commit with a concise message summarizing changes.\n- Do not push to any remote.\n- If actions would be destructive, explain and skip those actions.\n`;
        recipeYaml = `title: MCP Headless Run\ndescription: Headless run with git init/branch/commit workflow\nprompt: |\n  ${prompt.split('\n').join('\n  ')}\n`;
      }
    } catch (e) {
      throw new Error(`failed to prepare runtime recipe: ${e?.message || e}`);
    }
    fs.writeFileSync(recipePath, recipeYaml, 'utf8');

    // Build final args: always headless recipe with developer builtin
    const finalArgs = sanitizeArgs(['--no-session', '--with-builtin', 'developer', '--recipe', recipePath]);

    // Enforce single concurrency
    if (getRunningJobId()) {
      const err = new Error('A job is already running. Concurrency is limited to 1.');
      err.code = 'BUSY';
      throw err;
    }

    const { jobId, pid, startedAt } = startJob({
      command: normalized,
      args: finalArgs,
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });

    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_recipe_validate
server.registerTool(
  'goose_recipe_validate',
  {
    title: 'Recipe Validate',
    description: 'Validate a Goose recipe file',
    inputSchema: { file: z.string().describe('Path to recipe yaml file (relative to scope dir)') }
  },
  async ({ file }) => {
    // Spawn as a managed job to support long validations
    const { jobId, pid, startedAt } = startJob({
      command: 'recipe',
      args: sanitizeArgs(['validate', file]),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_recipe_deeplink
server.registerTool(
  'goose_recipe_deeplink',
  {
    title: 'Recipe Deeplink',
    description: 'Generate a shareable link for a recipe file',
    inputSchema: { file: z.string().describe('Path to recipe yaml file (relative to scope dir)') }
  },
  async ({ file }) => {
    const { jobId, pid, startedAt } = startJob({
      command: 'recipe',
      args: sanitizeArgs(['deeplink', file]),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_session_list
server.registerTool(
  'goose_session_list',
  {
    title: 'Session List',
    description: 'List saved sessions',
    inputSchema: {
      verbose: z.boolean().optional(),
      format: z.enum(['text', 'json']).optional(),
      ascending: z.boolean().optional()
    }
  },
  async ({ verbose = false, format, ascending = false }) => {
    const args = ['session', 'list'];
    if (verbose) args.push('--verbose');
    if (format) args.push('--format', format);
    if (ascending) args.push('--ascending');
    const { jobId, pid, startedAt } = startJob({
      command: args.shift(),
      args: sanitizeArgs(args),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes,
      echoToConsole: config.echoJobLogs
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_session_export
server.registerTool(
  'goose_session_export',
  {
    title: 'Session Export',
    description: 'Export a session to Markdown or stdout',
    inputSchema: {
      id: z.string().optional(),
      name: z.string().optional(),
      path: z.string().optional(),
      output: z.string().optional()
    }
  },
  async ({ id, name, path: pth, output }) => {
    const args = ['session', 'export'];
    if (id) args.push('--id', id);
    if (name) args.push('--name', name);
    if (pth) args.push('--path', pth);
    if (output) args.push('--output', output);
    const { jobId, pid, startedAt } = startJob({
      command: args.shift(),
      args: sanitizeArgs(args),
      env: {},
      cwd: config.scopeDir,
      goosePath: config.gooseBinary,
      logMaxBytes: config.logMaxBytes
    });
    return { content: [{ type: 'text', text: JSON.stringify({ jobId, pid, startedAt }, null, 2) }] };
  }
);

// Tool: goose_status
server.registerTool(
  'goose_status',
  { title: 'Job Status', description: 'Get status of a Goose job', inputSchema: { jobId: z.string() } },
  async ({ jobId }) => {
    const st = jobStatus(jobId);
    if (!st) throw new Error('job not found');
    return { content: [{ type: 'text', text: JSON.stringify(st, null, 2) }] };
  }
);

// Tool: goose_stream_logs
server.registerTool(
  'goose_stream_logs',
  {
    title: 'Stream Logs',
    description: 'Read job logs incrementally',
    inputSchema: { jobId: z.string(), which: z.enum(['stdout', 'stderr']).optional(), offset: z.number().optional(), maxBytes: z.number().optional() }
  },
  async ({ jobId, which = 'stdout', offset = 0, maxBytes = 65536 }) => {
    const chunk = streamLogs(jobId, which, offset, maxBytes);
    if (!chunk) throw new Error('job not found');
    return { content: [{ type: 'text', text: JSON.stringify({ data: chunk.data, nextOffset: chunk.nextOffset, isEnd: chunk.isEnd }, null, 2) }] };
  }
);

// Tool: goose_get_output
server.registerTool(
  'goose_get_output',
  { title: 'Get Output', description: 'Fetch final combined output', inputSchema: { jobId: z.string() } },
  async ({ jobId }) => {
    const out = getOutput(jobId);
    if (!out) throw new Error('job not found');
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
);

// Tool: goose_stop
server.registerTool(
  'goose_stop',
  { title: 'Stop Job', description: 'Cancel a running Goose job', inputSchema: { jobId: z.string(), signal: z.enum(['SIGINT', 'SIGTERM']).optional() } },
  async ({ jobId, signal = 'SIGTERM' }) => {
    const result = stopJob(jobId, signal);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// MCP endpoint with auth
app.post('/mcp', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null });
    }
  }
});

// SSE event stream for live-reload on publish
const sseClients = new Set();
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    try { res.end(); } catch (_) {}
  });
});

function broadcastReload(info = {}) {
  const payload = JSON.stringify({ at: Date.now(), ...info });
  for (const res of sseClients) {
    try { res.write('event: reload\n'); res.write(`data: ${payload}\n\n`); } catch (_) {}
  }
}

// Helper: list preview branches from filesystem
const PREVIEW_ROOT = resolvePreviewRoot();
function listPreviewBranches() {
  const out = [];
  // main branch entry
  out.push({ name: 'main', url: '/' });
  try {
    const dir = path.join(PREVIEW_ROOT, '.preview');
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        out.push({ name: ent.name, url: `/.preview/${ent.name}/` });
      }
    }
  } catch (_) {}
  return out;
}

// HTML injection middleware: inject floating branch switcher and SSE client
function needsInjection(filePath) {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

function buildInjected(html, currentPath = '/') {
  const branches = listPreviewBranches();
  const nav = `
  <style>
    ._goose_preview_nav{position:fixed;right:16px;bottom:16px;z-index:99999;font:14px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    ._goose_preview_nav .box{background:#111d28;color:#dfe9f1;border:1px solid #2a3b4a;border-radius:10px;padding:10px 12px;box-shadow:0 6px 18px rgba(0,0,0,0.25)}
    ._goose_preview_nav .title{font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.8;margin-bottom:6px}
    ._goose_preview_nav a{display:block;color:#bde0fe;text-decoration:none;padding:6px 4px;border-radius:6px}
    ._goose_preview_nav a:hover{background:#18324a}
    ._goose_preview_nav .active{color:#fff;background:#29557a}
    ._goose_preview_nav .hint{margin-top:8px;font-size:12px;color:#e8f7ff;opacity:0;transition:opacity .25s}
  </style>
  <div class="_goose_preview_nav"><div class="box">
    <div class="title">Preview Branches</div>
    ${branches.map(b => `<a href="${b.url}" class="${currentPath.startsWith(b.url) ? 'active' : ''}">${b.name}</a>`).join('')}
    <div class="hint" id="_goose_preview_hint"></div>
  </div></div>
  <script>
    (function(){
      function showHint(msg){
        var el=document.getElementById('_goose_preview_hint');
        if(!el) return; el.textContent=msg; el.style.opacity='1';
        try{clearTimeout(window._goose_hint_t);}catch(_){}}
      try{
        var es=new EventSource('/events');
        es.addEventListener('reload',function(ev){
          var data={}; try{ data = JSON.parse(ev.data||'{}'); }catch(_){ }
          showHint('Updated ' + (data.branch || 'site') + ' — reloading…');
          setTimeout(function(){ location.reload(); }, 650);
        });
      }catch(_){ }
    })();
  </script>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', nav + '\n</body>');
  }
  return html + nav;
}

function tryServeInjected(baseDir) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    // Map URL path to filesystem under baseDir
    let rel = decodeURIComponent(req.path);
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = path.join(baseDir, rel);
    // Prevent path traversal
    if (!filePath.startsWith(baseDir)) return res.status(403).end();
    try {
      const st = fs.statSync(filePath);
      if (st.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const html = fs.readFileSync(indexPath, 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(buildInjected(html, req.path.endsWith('/') ? req.path : req.path + '/'));
        }
        return next();
      }
      if (needsInjection(filePath)) {
        const html = fs.readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(buildInjected(html, req.path));
      }
      return next();
    } catch (_) {
      return next();
    }
  };
}

// Static hosting for published sites (main at '/', previews at '/.preview/<branch>/')
app.use('/.preview', tryServeInjected(path.join(PREVIEW_ROOT)));
app.use('/', tryServeInjected(PREVIEW_ROOT));
app.use('/.preview', express.static(path.join(PREVIEW_ROOT, '.preview')));
app.use('/', express.static(PREVIEW_ROOT));

// Start HTTP server
const PORT = config.port || 3003;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[mcp-goose] listening on http://0.0.0.0:${PORT}`);
  console.log(`[mcp-goose] MCP endpoint: POST http://localhost:${PORT}/mcp`);

  // Initial publish of current branch to local static root
  try {
    const result = await publishCurrentBranch(config.scopeDir);
    console.log(`[preview] published branch '${result.branch}' → ${result.targetDir}`);
    console.log(`[preview] URL: ${result.url}`);
    broadcastReload({ branch: result.branch });
  } catch (e) {
    console.warn(`[preview] initial publish failed: ${e?.message || e}`);
  }

  // Watch for git HEAD/branch changes and republish
  let republishTimer = null;
  const debounce = (fn, ms) => {
    return () => {
      if (republishTimer) clearTimeout(republishTimer);
      republishTimer = setTimeout(fn, ms);
    };
  };
  const onGitChange = debounce(async () => {
    try {
      const result = await publishCurrentBranch(config.scopeDir);
      console.log(`[preview] republished '${result.branch}' → ${result.targetDir}`);
      broadcastReload({ branch: result.branch });
    } catch (e) {
      console.warn(`[preview] republish failed: ${e?.message || e}`);
    }
  }, 500);
  try {
    initGitWatcher(config.scopeDir, onGitChange);
    console.log('[preview] git watcher active');
  } catch (e) {
    console.warn(`[preview] git watcher failed: ${e?.message || e}`);
  }
});
