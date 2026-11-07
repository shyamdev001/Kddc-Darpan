import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { extname } from 'path';

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Multer (busboy) decodes multipart file names as Latin-1, which turns Gujarati names into
 * mojibake (the bug that broke the old system). Browsers send UTF-8, so re-decode the bytes.
 */
export function decodeUploadName(raw: string): string {
  const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
  const name = utf8.includes('�') ? raw : utf8;
  return name.normalize('NFC');
}

/** "દિવાળી_ઓફર-2026.jpg" -> "દિવાળી ઓફર 2026". Keeps the script as typed; only tidies separators. */
export function displayNameFrom(fileName: string): string {
  const base = fileName.slice(0, fileName.length - extname(fileName).length) || fileName;
  const tidy = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (tidy || 'Untitled').slice(0, 200);
}

/** Runs a command without a shell and resolves with stdout. Rejects with the tail of stderr. */
export function run(cmd: string, args: string[], timeoutMs = 30 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new Error(missing ? `${cmd} is not installed or not on PATH (set FFMPEG_PATH / FFPROBE_PATH)` : err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `${cmd} exited with code ${code}`));
    });
  });
}
