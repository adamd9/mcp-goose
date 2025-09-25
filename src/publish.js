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

async function rmDirContents(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (ent) => {
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

export function resolvePreviewRoot() {
  return DEFAULT_PREVIEW_ROOT;
}

function resolveTargetDir(previewRoot, branch) {
  if (branch === MAIN_BRANCH) return previewRoot;
  const slug = branchSlug(branch);
  return path.join(previewRoot, PREVIEW_PREFIX, slug);
}

export async function publishCurrentBranch(scopeDir) {
  const branch = await detectBranch(scopeDir);
  const previewRoot = resolvePreviewRoot();
  const targetDir = resolveTargetDir(previewRoot, branch);

  ensureDirSync(previewRoot);
  ensureDirSync(path.dirname(targetDir));
  ensureDirSync(targetDir);

  if (!isSubPath(previewRoot, targetDir)) {
    throw new Error('Resolved targetDir is outside of previewRoot');
  }

  await rmDirContents(targetDir);
  await copyDir(scopeDir, targetDir);

  const url = branch === MAIN_BRANCH
    ? `http://localhost:${process.env.PORT || 3003}/`
    : `http://localhost:${process.env.PORT || 3003}/${PREVIEW_PREFIX}/${branchSlug(branch)}/`;

  return { branch, targetDir, url };
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
