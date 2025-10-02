import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

// Simple constants to keep first version clean (no env customizations)
const MAIN_BRANCH = 'main';
const PREVIEW_PREFIX = '.preview';
const DEFAULT_PREVIEW_ROOT = path.join(os.homedir(), '.cache', 'mcp-goose', 'www');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isSubPath(parent, child) {
  const rp = path.resolve(parent);
  const rc = path.resolve(child);
  return rc === rp || rc.startsWith(rp + path.sep);
}

function branchSlug(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function rmDirContents(dir, skipNames = []) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (ent) => {
      // Skip directories/files that should be preserved
      if (skipNames.includes(ent.name)) return;
      const p = path.join(dir, ent.name);
      await fsp.rm(p, { recursive: true, force: true });
    }));
  } catch (e) {
    if (e && e.code === 'ENOENT') return; // ok
    throw e;
  }
}

async function copyDir(src, dest) {
  // Minimal filter: skip .git
  const skipNames = new Set(['.git']);
  ensureDirSync(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (skipNames.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else if (ent.isSymbolicLink()) {
      // Skip symlinks to keep it simple/safe
      continue;
    } else {
      await fsp.mkdir(path.dirname(d), { recursive: true });
      await fsp.copyFile(s, d);
    }
  }
}

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' });
    });
  });
}

async function detectBranch(scopeDir) {
  // Try git branch name
  try {
    const { error, stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: scopeDir });
    if (!error) {
      const name = stdout.trim();
      if (name && name !== 'HEAD') return name;
    }
  } catch (_) {}
  // Fallback to env if provided by CI
  if (process.env.BRANCH_NAME) return process.env.BRANCH_NAME;
  return MAIN_BRANCH; // sensible default
}

async function ensureScopeReady(scopeDir) {
  // Ensure the working directory exists
  try {
    await fsp.mkdir(scopeDir, { recursive: true });
  } catch (_) {}

  // If not a git repo, initialize one (best-effort)
  try {
    const { error } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: scopeDir });
    const notRepo = !!error;
    if (notRepo) {
      // Initialize with main as default branch where supported
      let inited = false;
      const attempts = [
        ['init', '-b', 'main'],
        ['init']
      ];
      for (const args of attempts) {
        const { error: e } = await execFileAsync('git', args, { cwd: scopeDir });
        if (!e) { inited = true; break; }
      }
      if (inited) {
        // If branch wasn't set, attempt to set HEAD to main
        await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: scopeDir });
      }
    }
  } catch (_) {
    // Non-fatal; publishing will still proceed using default MAIN_BRANCH
  }

  // Create a README.md with guidance for Goose if missing
  try {
    const readmePath = path.join(scopeDir, 'README.md');
    const exists = await fsp.access(readmePath).then(() => true).catch(() => false);
    if (!exists) {
      const lines = [
        '# Project: Website managed by Goose (Agentic AI)',
        '',
        'This directory is the working tree for a website maintained entirely by Goose (an agentic AI).',
        'The MCP server (mcp-goose) limits Goose operations to this folder and enforces non-interactive, reproducible workflows.',
        '',
        '## Goals',
        '- Build and maintain a fast, accessible, and responsive website.',
        '- Keep the project simple and transparent for humans to review.',
        '',
        '## Allowed Tech & Frameworks',
        '- Primary: Static site using HTML, CSS, and vanilla JavaScript.',
        '- Optional CSS tooling: Tailwind CSS (via CDN) or lightweight utility CSS.',
        '- Optional JS: Minimal, framework-free; consider progressive enhancement.',
        '- Avoid: Server-side runtimes, heavy build systems, or frameworks unless explicitly instructed.',
        '',
        '## Content & Assets',
        '- Prefer local assets (images, fonts).',
        '- If using external resources (e.g., fonts, CSS), pin versions and provide integrity where possible.',
        '- Optimize images for web; provide alt text and captions when relevant.',
        '',
        '## Accessibility & Quality',
        '- Follow WCAG best practices; ensure semantic HTML.',
        '- Ensure keyboard navigability and sufficient color contrast.',
        '- Test on common viewport sizes; ensure responsive layout.',
        '- Avoid intrusive animations; respect reduced motion preferences.',
        '',
        '## Structure',
        '- Use `index.html` as the entry point.',
        '- Organize assets under `/assets` (e.g., /assets/css, /assets/js, /assets/img).',
        '- Keep pages small and modular; reuse components when reasonable.',
        '',
        '## Git & Workflow',
        '- Always work on the current branch; create feature branches if needed.',
        '- Commit with concise, descriptive messages.',
        '- Do not push to any remote from this environment.',
        '- Do not remove or alter files outside this scope directory.',
        '',
        '## Security & Safety',
        '- Do not run arbitrary shell commands; operations are performed via the Goose CLI under MCP guardrails.',
        '- Avoid handling secrets in this repository.',
        '',
        '## Deployment & Preview',
        '- Local previews are served by mcp-goose at http://localhost:3003/ (main) or /.preview/<branch>/.',
        '- Only committed changes are published to the local preview.',
        '',
        '## Getting Started',
        '- Begin by creating a minimal index.html and supporting assets.',
        '- Keep the design simple and user-friendly.'
      ];
      const content = lines.join('\n');
      await fsp.writeFile(readmePath, content, 'utf8');
    }
  } catch (_) {
    // Non-fatal if README cannot be created
  }
}

export function resolvePreviewRoot() {
  return DEFAULT_PREVIEW_ROOT;
}

function resolveTargetDir(previewRoot, branch) {
  if (branch === MAIN_BRANCH) return previewRoot;
  const slug = branchSlug(branch);
  return path.join(previewRoot, PREVIEW_PREFIX, slug);
}

export async function publishCurrentBranch(scopeDir) {
  await ensureScopeReady(scopeDir);
  const branch = await detectBranch(scopeDir);
  const previewRoot = resolvePreviewRoot();
  const targetDir = resolveTargetDir(previewRoot, branch);

  ensureDirSync(previewRoot);
  ensureDirSync(path.dirname(targetDir));
  ensureDirSync(targetDir);

  if (!isSubPath(previewRoot, targetDir)) {
    throw new Error('Resolved targetDir is outside of previewRoot');
  }

  // When publishing main, preserve the .preview directory
  const skipNames = (branch === MAIN_BRANCH) ? [PREVIEW_PREFIX] : [];
  await rmDirContents(targetDir, skipNames);
  await copyDir(scopeDir, targetDir);

  const url = branch === MAIN_BRANCH
    ? `http://localhost:${process.env.PORT || 3003}/`
    : `http://localhost:${process.env.PORT || 3003}/${PREVIEW_PREFIX}/${branchSlug(branch)}/`;

  return { branch, targetDir, url };
}

async function getAllBranches(scopeDir) {
  const { error, stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: scopeDir });
  if (error) return [];
  return stdout.trim().split('\n').filter(b => b.trim());
}

export async function publishAllBranches(scopeDir) {
  await ensureScopeReady(scopeDir);
  const branches = await getAllBranches(scopeDir);
  const results = [];
  const currentBranch = await detectBranch(scopeDir);
  
  console.log(`[publishAllBranches] Found ${branches.length} branches: ${branches.join(', ')}`);
  console.log(`[publishAllBranches] Current branch: ${currentBranch}`);
  
  for (const branch of branches) {
    try {
      console.log(`[publishAllBranches] Checking out '${branch}'...`);
      // Checkout the branch
      const { error: checkoutError, stderr } = await execFileAsync('git', ['checkout', branch], { cwd: scopeDir });
      if (checkoutError) {
        console.warn(`[publishAllBranches] Failed to checkout '${branch}': ${stderr || checkoutError.message || checkoutError}`);
        continue;
      }
      
      // Publish it
      console.log(`[publishAllBranches] Publishing '${branch}'...`);
      const result = await publishCurrentBranch(scopeDir);
      results.push(result);
      console.log(`[publishAllBranches] ✓ Published '${branch}' → ${result.targetDir}`);
      
      // Verify the directory exists
      try {
        const stat = await fsp.stat(result.targetDir);
        console.log(`[publishAllBranches]   Directory exists: ${stat.isDirectory()}`);
      } catch (e) {
        console.warn(`[publishAllBranches]   WARNING: Directory does not exist after publish!`);
      }
    } catch (e) {
      console.warn(`[publishAllBranches] Failed to publish '${branch}': ${e?.message || e}`);
      console.warn(e);
    }
  }
  
  // Return to original branch
  console.log(`[publishAllBranches] Returning to '${currentBranch}'...`);
  try {
    await execFileAsync('git', ['checkout', currentBranch], { cwd: scopeDir });
  } catch (e) {
    console.warn(`[publishAllBranches] Failed to return to '${currentBranch}': ${e?.message || e}`);
  }
  
  return results;
}

export function initGitWatcher(scopeDir, onChange) {
  // Watch both HEAD and the current branch ref if possible
  const gitDir = path.join(scopeDir, '.git');
  let watchers = [];
  let pollTimer = null;
  let lastHeadHash = null;

  function safeWatch(filePath) {
    try {
      const w = fs.watch(filePath, { persistent: true }, (evt) => {
        // debounce simple
        if (typeof onChange === 'function') onChange();
      });
      watchers.push(w);
    } catch (_) {}
  }

  // Watch HEAD file
  safeWatch(path.join(gitDir, 'HEAD'));

  // Try to discover the branch ref file
  (async () => {
    try {
      const headContent = await fsp.readFile(path.join(gitDir, 'HEAD'), 'utf8');
      const m = headContent.match(/ref:\s*(.*)\s*$/);
      if (m && m[1]) safeWatch(path.join(gitDir, m[1]));
    } catch (_) {}
  })();

  // Also watch packed-refs (when refs are packed, branch updates go here)
  safeWatch(path.join(gitDir, 'packed-refs'));

  // Best-effort: watch the refs/heads directory (recursive on macOS/Windows only)
  try {
    const headsDir = path.join(gitDir, 'refs', 'heads');
    const w = fs.watch(headsDir, { persistent: true, recursive: true }, () => {
      if (typeof onChange === 'function') onChange();
    });
    watchers.push(w);
  } catch (_) {}

  // Polling fallback: check HEAD hash periodically to catch missed events
  async function pollHead() {
    try {
      const { error, stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: scopeDir });
      if (!error) {
        const hash = stdout.trim();
        if (hash && hash !== lastHeadHash) {
          lastHeadHash = hash;
          if (typeof onChange === 'function') onChange();
        }
      }
    } catch (_) {}
  }
  pollTimer = setInterval(pollHead, 2000);
  // Prime lastHeadHash
  pollHead();

  return () => {
    for (const w of watchers) {
      try { w.close(); } catch (_) {}
    }
    watchers = [];
    if (pollTimer) {
      try { clearInterval(pollTimer); } catch (_) {}
      pollTimer = null;
    }
  };
}
