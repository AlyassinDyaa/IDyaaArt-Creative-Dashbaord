// Cloudflare R2 object storage — used to hold binary blobs (images, PDFs) outside the
// database so storage isn't capped by Mongo's free tier and large editor images stop
// bloating document HTML. R2 speaks the S3 API; we sign requests with the tiny
// aws4fetch library (fetch-based, no AWS SDK cold-start bloat on Vercel).
//
// Credentials come from a passed-in config object first, then env vars:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
import { AwsClient } from 'aws4fetch'

export function r2Config(over) {
  const o = over || {}
  return {
    accountId: o.accountId || process.env.R2_ACCOUNT_ID || '',
    accessKeyId: o.accessKeyId || process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: o.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: o.bucket || process.env.R2_BUCKET || '',
    publicUrl: (o.publicUrl || process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  }
}

// credentials present → we can upload/delete
export function r2Enabled(over) {
  const c = r2Config(over)
  return !!(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket)
}
// credentials AND a public base URL → we can also hand the browser a directly-loadable link
export function r2CanServe(over) {
  return r2Enabled(over) && !!r2Config(over).publicUrl
}

function clientAndBase(c) {
  const aws = new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: 'auto', service: 's3' })
  return { aws, base: `https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}` }
}
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/')

export function r2PublicUrl(key, over) {
  const c = r2Config(over)
  return c.publicUrl ? `${c.publicUrl}/${encodeKey(key)}` : ''
}

export async function r2Put(key, body, contentType, over) {
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  const res = await aws.fetch(`${base}/${encodeKey(key)}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': contentType || 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`R2 put failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return r2PublicUrl(key, over)
}

export async function r2Delete(key, over) {
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  await aws.fetch(`${base}/${encodeKey(key)}`, { method: 'DELETE' }).catch(() => {})
}

// fetch an object's bytes (used to serve when there's no public URL configured)
export async function r2Get(key, over) {
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  const res = await aws.fetch(`${base}/${encodeKey(key)}`)
  if (!res.ok) return null
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' }
}

// Total bytes + object count in the bucket (ListObjectsV2, paginated). Used for the
// dashboard storage gauge. Capped at 50k objects as a safety bound.
export async function r2Usage(over) {
  if (!r2Enabled(over)) return null
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  let token = ''
  let used = 0
  let objects = 0
  for (let page = 0; page < 50; page++) {
    const url = `${base}?list-type=2&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`
    const res = await aws.fetch(url)
    if (!res.ok) throw new Error(`R2 list failed (${res.status})`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      used += Number(m[1])
      objects++
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && next) token = next[1]
    else break
  }
  return { used, objects }
}

// List every object (key + size), XML-unescaped so keys match exactly what's stored.
const xmlUnescape = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
export async function r2ListAll(over) {
  if (!r2Enabled(over)) return []
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  let token = ''
  const out = []
  for (let page = 0; page < 50; page++) {
    const url = `${base}?list-type=2&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`
    const res = await aws.fetch(url)
    if (!res.ok) throw new Error(`R2 list failed (${res.status})`)
    const xml = await res.text()
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const seg = block[1]
      const key = seg.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]
      const size = Number(seg.match(/<Size>(\d+)<\/Size>/)?.[1] || 0)
      if (key) out.push({ key: xmlUnescape(key), size })
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && next) token = next[1]
    else break
  }
  return out
}

// presigned PUT URL so the browser can upload large files straight to R2,
// bypassing the host's request-body size limit (e.g. Vercel's ~4.5 MB cap).
export async function r2PresignPut(key, contentType, over, expiresIn = 600) {
  const c = r2Config(over)
  const { aws, base } = clientAndBase(c)
  const signed = await aws.sign(`${base}/${encodeKey(key)}?X-Amz-Expires=${expiresIn}`, {
    method: 'PUT',
    headers: { 'content-type': contentType || 'application/octet-stream' },
    aws: { signQuery: true },
  })
  return signed.url
}
