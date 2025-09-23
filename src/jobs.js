import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

// In-memory job store
const jobs = new Map();
let runningJobId = null; // enforce single concurrency

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function makeRingBuffer(maxBytes) {
  let buffer = Buffer.alloc(0);
  return {
    append(chunk) {
      if (!chunk || chunk.length === 0) return;
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length > maxBytes) {
        buffer = buffer.slice(buffer.length - maxBytes);
      }
    },
    read(offset = 0, max = 65536) {
      const start = Math.min(offset, buffer.length);
      const end = Math.min(start + max, buffer.length);
      const slice = buffer.subarray(start, end);
      return { data: slice.toString('utf8'), nextOffset: end, isEnd: end >= buffer.length };
    },
    full() { return buffer.toString('utf8'); },
    size() { return buffer.length; }
  };
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function getRunningJobId() {
  return runningJobId;
}

export function listJobs() {
  return Array.from(jobs.values()).map(j => ({
    jobId: j.id,
    status: j.status,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    exitCode: j.exitCode
  }));
}

export function startJob({ command, args, env, cwd, goosePath, logMaxBytes }) {
  if (runningJobId) {
    const err = new Error('A job is already running. Concurrency is limited to 1.');
    err.code = 'BUSY';
    throw err;
  }

  const id = newId();
  const stdoutBuf = makeRingBuffer(logMaxBytes);
  const stderrBuf = makeRingBuffer(logMaxBytes);
  const startedAt = new Date().toISOString();

  const child = spawn(goosePath, [command, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });

  const job = {
    id,
    pid: child.pid,
    status: 'running',
    command, args, cwd,
    startedAt,
    finishedAt: null,
    exitCode: null,
    stdout: stdoutBuf,
    stderr: stderrBuf,
    child
  };

  jobs.set(id, job);
  runningJobId = id;

  child.stdout.on('data', (d) => stdoutBuf.append(d));
  child.stderr.on('data', (d) => stderrBuf.append(d));

  child.on('exit', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'completed' : 'failed';
    job.finishedAt = new Date().toISOString();
    runningJobId = null;
  });

  child.on('error', (e) => {
    stderrBuf.append(`\n[spawn error] ${String(e?.message || e)}\n`);
  });

  return { jobId: id, pid: child.pid, startedAt };
}

export function stopJob(jobId, signal = 'SIGTERM') {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.status !== 'running') return { ok: false, reason: 'not_running' };
  try {
    process.kill(job.child.pid, signal);
    job.status = 'canceled';
    job.finishedAt = new Date().toISOString();
    runningJobId = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'kill_failed', error: String(e) };
  }
}

export function jobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  const runtimeSeconds = job.startedAt && !job.finishedAt
    ? Math.floor((Date.now() - Date.parse(job.startedAt)) / 1000)
    : job.finishedAt
      ? Math.floor((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000)
      : 0;
  return {
    jobId: job.id,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    runtimeSeconds
  };
}

export function streamLogs(jobId, which = 'stdout', offset = 0, max = 65536) {
  const job = jobs.get(jobId);
  if (!job) return null;
  const buf = which === 'stderr' ? job.stderr : job.stdout;
  const { data, nextOffset, isEnd } = buf.read(offset, max);
  return { data, nextOffset, isEnd };
}

export function getOutput(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { stdout: job.stdout.full(), stderr: job.stderr.full(), exitCode: job.exitCode };
}
