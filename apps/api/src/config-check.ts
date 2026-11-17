/**
 * Production settings check, run before the API starts. A missing or unsafe setting on the server
 * would otherwise fail quietly at the branches: e.g. without PUBLIC_BASE_URL every TV is told to
 * download its ads from "localhost" and never gets them. Better to refuse to start, with a clear list.
 */

type Env = Record<string, string | undefined>;

export interface ConfigReport {
  /** Each one stops the start. */
  problems: string[];
  /** Allowed, but worth a look. */
  warnings: string[];
  /** What the server will use, without any secret. */
  summary: Record<string, string>;
}

function httpsUrl(env: Env, name: string, problems: string[]): string {
  const raw = (env[name] ?? '').trim();
  if (!raw) {
    problems.push(`${name} is not set. It must be the dashboard's https address, e.g. https://signage.example.com`);
    return '';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`${name} "${raw}" is not a web address.`);
    return raw;
  }
  if (url.protocol !== 'https:') problems.push(`${name} must start with https:// (now "${raw}"). TVs and browsers send their keys over it.`);
  return raw;
}

export function checkProductionConfig(env: Env = process.env): ConfigReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set.');

  const publicUrl = httpsUrl(env, 'PUBLIC_BASE_URL', problems);
  const webOrigin = httpsUrl(env, 'WEB_ORIGIN', problems);

  const jwt = env.JWT_SECRET ?? '';
  if (!jwt || jwt === 'change-me' || jwt.length < 32) problems.push('JWT_SECRET must be a random string of 32+ characters.');

  if (Buffer.from(env.TOTP_ENCRYPTION_KEY ?? '', 'base64').length !== 32) {
    problems.push('TOTP_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32).');
  }

  const storage = env.STORAGE_DRIVER ?? 'local';
  if (storage === 'local' && !env.STORAGE_LOCAL_DIR) problems.push('STORAGE_LOCAL_DIR is not set.');

  const twoFa = env.REQUIRE_2FA ?? 'admins';
  if (twoFa === 'off') warnings.push('REQUIRE_2FA=off: admins can sign in with a password alone. Use "admins" or "all".');

  const trust = env.TRUST_PROXY ?? '';
  if (!trust || trust === 'loopback') {
    warnings.push('TRUST_PROXY is "loopback": behind Caddy in Docker every request will seem to come from the proxy, so rate limits are shared.');
  }

  if ((env.MAIL_DRIVER ?? 'console') === 'console') warnings.push('MAIL_DRIVER=console: offline alerts are only written to the log, not emailed.');

  return {
    problems,
    warnings,
    summary: {
      PUBLIC_BASE_URL: publicUrl,
      WEB_ORIGIN: webOrigin,
      STORAGE_DRIVER: storage,
      REQUIRE_2FA: twoFa,
      TRUST_PROXY: trust || 'loopback',
      MAIL_DRIVER: env.MAIL_DRIVER ?? 'console',
    },
  };
}

/** Throws with every problem at once when NODE_ENV=production; returns the report otherwise too. */
export function assertProductionConfig(env: Env = process.env, log: (line: string) => void = console.log): ConfigReport | null {
  if (env.NODE_ENV !== 'production') return null;
  const report = checkProductionConfig(env);
  if (report.problems.length) {
    throw new Error(`KDCC Darpan cannot start: fix these settings in deploy/.env\n  - ${report.problems.join('\n  - ')}`);
  }
  log(`Production settings: ${Object.entries(report.summary).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const w of report.warnings) log(`Warning: ${w}`);
  return report;
}
