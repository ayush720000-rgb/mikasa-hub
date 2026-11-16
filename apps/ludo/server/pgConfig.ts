import type pg from 'pg';

// sslmode values this helper understands. Anything else is passed through untouched.
const KNOWN_MODES = new Set(['disable', 'no-verify', 'require', 'prefer', 'verify-ca', 'verify-full']);

/**
 * Turn a DATABASE_URL into pool options without the `sslmode` query parameter.
 *
 * pg-connection-string warns that 'require' is treated as 'verify-full' and will change in
 * the next major version. Taking sslmode out of the URL and setting `ssl` explicitly keeps the
 * same behaviour (TLS with certificate verification) and silences the warning.
 *
 *   disable    -> no TLS
 *   no-verify  -> TLS without certificate checks
 *   others     -> TLS with certificate checks (what pg does today)
 *
 * A URL without sslmode, with uselibpqcompat, with an unknown mode, or one that cannot be
 * parsed is passed to pg unchanged, so pg decides what to do with it.
 */
export function pgPoolConfig(connectionString: string): pg.PoolConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  const mode = url.searchParams.get('sslmode');
  if (mode === null || !KNOWN_MODES.has(mode) || url.searchParams.has('uselibpqcompat')) {
    return { connectionString };
  }
  url.searchParams.delete('sslmode');
  const ssl = mode === 'disable' ? false : { rejectUnauthorized: mode !== 'no-verify' };
  return { connectionString: url.toString(), ssl };
}
