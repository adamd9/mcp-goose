import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

dotenv.config();

// Determine goose binary path with sensible fallbacks
let resolvedGoose = process.env.GOOSE_BINARY || 'goose';
if (resolvedGoose === 'goose') {
  const candidate = path.join(os.homedir(), '.local', 'bin', 'goose');
  if (fs.existsSync(candidate)) {
    resolvedGoose = candidate;
  }
}

function slugify(name) {
  return String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'app';
}

// Determine base projects directory and scope directory
const userProvidedScopeDir = !!process.env.GOOSE_SCOPE_DIR;
const userProvidedProjectName = !!process.env.PROJECT_NAME;
const projectName = process.env.PROJECT_NAME || 'app';

// Base projects directory: configurable via GOOSE_PROJECTS_DIR, defaults to ./projects
const projectsBaseDir = process.env.GOOSE_PROJECTS_DIR 
  ? path.resolve(process.env.GOOSE_PROJECTS_DIR)
  : path.resolve(process.cwd(), 'projects');

// Scope dir resolution priority:
// 1. GOOSE_SCOPE_DIR (direct path to a single project)
// 2. projectsBaseDir/<PROJECT_NAME> (managed project under base dir)
const defaultScopeDir = path.join(projectsBaseDir, slugify(projectName));

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  authToken: process.env.AUTH_TOKEN || '',
  scopeDir: process.env.GOOSE_SCOPE_DIR ? process.env.GOOSE_SCOPE_DIR : defaultScopeDir,
  gooseBinary: resolvedGoose,
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '1', 10),
  logMaxBytes: parseInt(process.env.LOG_MAX_BYTES || String(8_000_000), 10),
  echoJobLogs: /^(1|true|yes)$/i.test(process.env.ECHO_JOB_LOGS || 'true'),
};

export function validateConfig() {
  const errors = [];
  if (!config.authToken) errors.push('AUTH_TOKEN is required');
  if (!config.scopeDir) errors.push('scopeDir resolved empty');
  if (!path.isAbsolute(config.scopeDir)) errors.push('scopeDir must be an absolute path');
  // Enforce a project name when scopeDir is not explicitly provided by the user
  if (!userProvidedScopeDir && !userProvidedProjectName) {
    errors.push('PROJECT_NAME is required when GOOSE_SCOPE_DIR is not set');
  }
  if (config.maxConcurrency < 1) errors.push('MAX_CONCURRENCY must be >= 1');
  if (config.logMaxBytes < 1024) errors.push('LOG_MAX_BYTES must be >= 1024');
  return errors;
}
