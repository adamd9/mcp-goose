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

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  authToken: process.env.AUTH_TOKEN || '',
  scopeDir: process.env.GOOSE_SCOPE_DIR || '',
  gooseBinary: resolvedGoose,
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '1', 10),
  logMaxBytes: parseInt(process.env.LOG_MAX_BYTES || String(8_000_000), 10),
};

export function validateConfig() {
  const errors = [];
  if (!config.authToken) errors.push('AUTH_TOKEN is required');
  if (!config.scopeDir) errors.push('GOOSE_SCOPE_DIR is required');
  if (!path.isAbsolute(config.scopeDir)) errors.push('GOOSE_SCOPE_DIR must be an absolute path');
  if (config.maxConcurrency < 1) errors.push('MAX_CONCURRENCY must be >= 1');
  if (config.logMaxBytes < 1024) errors.push('LOG_MAX_BYTES must be >= 1024');
  return errors;
}
