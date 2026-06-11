import { File, FileArchive, FileImage, FileSpreadsheet, FileText, FileType2, Folder } from 'lucide-react'
import type { NodeType } from '../lib/types'

export function NodeIcon({ type, size = 15, color }: { type: NodeType; size?: number; color?: string }) {
  if (type === 'folder' && color) {
    return <Folder size={size} className="ico folder" style={{ color }} fill={color} fillOpacity={0.25} />
  }
  switch (type) {
    case 'folder':
      return <Folder size={size} className="ico folder" />
    case 'doc':
      return <FileText size={size} className="ico doc" />
    case 'image':
      return <FileImage size={size} className="ico image" />
    case 'pdf':
      return <FileType2 size={size} className="ico pdf" />
    case 'sheet':
      return <FileSpreadsheet size={size} className="ico sheet" />
    case 'word':
      return <FileText size={size} className="ico word" />
    case 'archive':
      return <FileArchive size={size} className="ico archive" />
    default:
      return <File size={size} className="ico file" />
  }
}
