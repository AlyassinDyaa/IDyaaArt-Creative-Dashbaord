export type NodeType = 'folder' | 'doc' | 'image' | 'pdf' | 'sheet' | 'word' | 'archive' | 'file'

export type AuthMode = 'subscription' | 'apikey'

export type SyncMode = 'offline' | 'online'

export interface SyncSummary {
  pushed: number
  pulled: number
  deletedLocal: number
  deletedRemote: number
}

export interface TreeNode {
  name: string
  path: string
  type: NodeType
  color?: string
  icon?: string
  size?: number
  updatedAt?: number
  children?: TreeNode[]
}

export const FOLDER_COLORS = ['#7c3aed', '#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#0c8599', '#c2255c']

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SearchResult {
  path: string
  title: string
  type: NodeType
  snippet: string
}
