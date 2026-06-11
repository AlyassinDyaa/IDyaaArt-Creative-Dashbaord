import crypto from 'node:crypto'
import path from 'node:path'

export const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])

export function nodeType(name) {
  const e = path.extname(name).toLowerCase()
  if (e === '.html') return 'doc'
  if (IMAGE.has(e)) return 'image'
  if (e === '.pdf') return 'pdf'
  if (['.xlsx', '.xls', '.csv'].includes(e)) return 'sheet'
  if (['.docx', '.doc'].includes(e)) return 'word'
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(e)) return 'archive'
  return 'file'
}

export const isBinaryType = (t) => t !== 'doc' && t !== 'folder'

export const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex')
