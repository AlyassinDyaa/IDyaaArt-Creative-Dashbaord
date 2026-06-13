// One-time migration: MongoDB (nodes + app + GridFS) → Cloudflare D1 (+ R2 for binaries).
// Reads creds from .entropy/config.json. Safe to re-run (INSERT OR REPLACE by path).
//
//   node scripts/migrate-mongo-to-d1.js --dry-run   # report only, writes nothing
//   node scripts/migrate-mongo-to-d1.js             # perform the migration
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { MongoClient, GridFSBucket } from 'mongodb'
import * as d1 from '../server/d1.js'
import * as r2 from '../server/r2.js'

const cfg = JSON.parse(readFileSync(new URL('../.entropy/config.json', import.meta.url), 'utf8'))
const d1over = cfg.d1
const r2over = cfg.r2
const mongoUri = cfg.mongoUri || process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB || 'entropy'
const DRY = process.argv.includes('--dry-run')

const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
}
const basename = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1) }
const extOf = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i).toLowerCase() }
const ctype = (p) => CONTENT_TYPE[extOf(p)] || 'application/octet-stream'

function downloadGrid(bucket, id) {
  return new Promise((resolve, reject) => {
    const chunks = []
    bucket.openDownloadStream(id).on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
  })
}

async function main() {
  if (!mongoUri) throw new Error('No mongoUri in .entropy/config.json')
  if (!d1.d1Enabled(d1over)) throw new Error('D1 not configured in .entropy/config.json')
  console.log(DRY ? '— DRY RUN (no writes) —' : '— MIGRATING —')

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  const db = client.db(dbName)
  const bucket = new GridFSBucket(db, { bucketName: 'files' })

  if (!DRY) await d1.d1InitSchema(d1over)

  const all = await db.collection('nodes').find({}).toArray()
  console.log(`Mongo nodes: ${all.length}`)

  const stat = { folders: 0, docs: 0, binMoved: 0, binKept: 0, tombstonesSkipped: 0, liveNoContent: 0, bytesMoved: 0 }
  for (const n of all) {
    // Skip deleted tombstones — only migrate live data.
    if (n.deleted) { stat.tombstonesSkipped++; continue }
    let type = n.type
    let html = null
    let r2Key = n.r2Key || null
    let size = n.size ?? null

    if (type === 'folder') {
      stat.folders++
    } else if (type === 'doc' || n.html !== undefined) {
      type = 'doc'
      html = n.html ?? ''
      stat.docs++
    } else if (n.gridId) {
      if (!r2.r2CanServe(r2over)) throw new Error('R2 not configured — needed to move GridFS binaries')
      const name = basename(n.path)
      const key = `files/${randomUUID()}/${name}`
      if (!DRY) {
        const buf = await downloadGrid(bucket, n.gridId)
        await r2.r2Put(key, buf, ctype(name), r2over)
        size = buf.length
        stat.bytesMoved += buf.length
      }
      r2Key = key
      stat.binMoved++
    } else if (r2Key) {
      stat.binKept++
    } else {
      stat.liveNoContent++
      console.warn('  ! live node with no content (skipped):', n.path)
      continue
    }

    if (!DRY) {
      await d1.d1Query(
        `INSERT OR REPLACE INTO nodes(path,type,html,r2_key,color,icon,size,updated_at,deleted,deleted_at)
         VALUES(?,?,?,?,?,?,?,?,0,NULL)`,
        [n.path, type, html, r2Key, n.color || null, n.icon || null, size, n.updatedAt || Date.now()],
        d1over
      )
    }
  }

  // app collection: config + auth
  const conf = await db.collection('app').findOne({ _id: 'config' })
  const auth = await db.collection('app').findOne({ _id: 'auth' })
  if (!DRY && conf) { const { _id, ...rest } = conf; await d1.d1Query('INSERT OR REPLACE INTO app(id,value) VALUES(?,?)', ['config', JSON.stringify(rest)], d1over) }
  if (!DRY && auth) { const { _id, ...rest } = auth; await d1.d1Query('INSERT OR REPLACE INTO app(id,value) VALUES(?,?)', ['auth', JSON.stringify(rest)], d1over) }

  console.log('Summary:', JSON.stringify(stat, null, 2))
  console.log(`MB moved to R2: ${(stat.bytesMoved / 1024 / 1024).toFixed(2)}`)
  console.log(`app → config:${conf ? 'yes' : 'none'} auth:${auth ? 'yes' : 'none'}`)
  if (!DRY) {
    const liveMigrated = stat.folders + stat.docs + stat.binMoved + stat.binKept
    const d1live = (await d1.d1Query('SELECT COUNT(*) AS c FROM nodes WHERE deleted=0', [], d1over))[0].c
    console.log(`VERIFY: D1 live nodes=${d1live}, expected=${liveMigrated} → ${d1live >= liveMigrated ? 'OK' : 'MISMATCH'}`)
  }
  await client.close()
}
main().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1) })
