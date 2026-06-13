// Cloudflare D1 (serverless SQLite) accessed over its REST API, so the same client
// works from both the local Express server and the Vercel function (D1's native
// binding is Workers-only). Credentials come from a passed-in config, then env vars:
//   CLOUDFLARE_ACCOUNT_ID (falls back to R2_ACCOUNT_ID — same account)
//   D1_DATABASE_ID
//   CLOUDFLARE_API_TOKEN  (needs the "D1 Edit" permission)
export function d1Config(over) {
  const o = over || {}
  return {
    accountId: o.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '',
    databaseId: o.databaseId || process.env.D1_DATABASE_ID || '',
    apiToken: o.apiToken || process.env.CLOUDFLARE_API_TOKEN || '',
  }
}

export function d1Enabled(over) {
  const c = d1Config(over)
  return !!(c.accountId && c.databaseId && c.apiToken)
}

// Run one parameterized statement; returns the array of result rows.
export async function d1Query(sql, params = [], over) {
  const c = d1Config(over)
  if (!d1Enabled(over)) throw new Error('Cloudflare D1 is not configured.')
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/d1/database/${c.databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${c.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  )
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`D1 query failed (${res.status})`)
  }
  if (!res.ok || !data.success) {
    const msg = (data.errors || []).map((e) => e.message || e).join('; ') || res.statusText
    throw new Error(`D1 query failed: ${msg}`)
  }
  return data.result?.[0]?.results || []
}

// Run one row-returning query and return just the first row (or null).
export async function d1First(sql, params = [], over) {
  const rows = await d1Query(sql, params, over)
  return rows[0] || null
}

// Execute a multi-statement script (e.g. schema init); no params.
export async function d1Exec(sqlScript, over) {
  return d1Query(sqlScript, [], over)
}

// Approximate storage usage: live node count + total bytes of inline HTML.
export async function d1Usage(over) {
  if (!d1Enabled(over)) return null
  const rows = await d1Query('SELECT COUNT(*) AS objects, COALESCE(SUM(LENGTH(html)),0) AS used FROM nodes WHERE deleted=0', [], over)
  return { used: Number(rows[0]?.used || 0), objects: Number(rows[0]?.objects || 0) }
}

// The schema: a single nodes table for the whole tree (folders + docs, content inline),
// plus a generic key/value app table for auth + config. Binaries live in R2 (r2_key).
export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  path       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  html       TEXT,
  r2_key     TEXT,
  hash       TEXT,
  color      TEXT,
  icon       TEXT,
  size       INTEGER,
  updated_at INTEGER,
  deleted    INTEGER DEFAULT 0,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nodes_deleted ON nodes(deleted);
CREATE TABLE IF NOT EXISTS app (
  id    TEXT PRIMARY KEY,
  value TEXT
);
`.trim()

export async function d1InitSchema(over) {
  await d1Exec(D1_SCHEMA, over)
  // Idempotently add the hash column for databases created before it existed.
  try {
    await d1Query('ALTER TABLE nodes ADD COLUMN hash TEXT', [], over)
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}
