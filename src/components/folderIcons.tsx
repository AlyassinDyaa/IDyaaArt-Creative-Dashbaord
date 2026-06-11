import {
  BookOpen, Bookmark, Calendar, Camera, Database, Feather, Film, Flag, Folder, Globe, Heart, Image,
  Info, Map, Music, Notebook, Star, Swords, Users, type LucideIcon,
} from 'lucide-react'

// generic icons a user can assign to a folder/project
export const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  book: BookOpen,
  notebook: Notebook,
  image: Image,
  film: Film,
  feather: Feather,
  users: Users,
  swords: Swords,
  map: Map,
  globe: Globe,
  database: Database,
  calendar: Calendar,
  info: Info,
  star: Star,
  heart: Heart,
  flag: Flag,
  bookmark: Bookmark,
  music: Music,
  camera: Camera,
}
export const FOLDER_ICON_NAMES = Object.keys(FOLDER_ICONS)

// renders a folder's glyph honoring its assigned icon + color
export function FolderGlyph({ name, color, size = 15 }: { name?: string; color?: string; size?: number }) {
  const isDefault = !name || name === 'folder'
  if (isDefault) {
    return color ? (
      <Folder size={size} className="ico folder" style={{ color }} fill={color} fillOpacity={0.25} />
    ) : (
      <Folder size={size} className="ico folder" />
    )
  }
  const Icon = FOLDER_ICONS[name] || Folder
  return <Icon size={size} className="ico folder" style={color ? { color } : undefined} />
}
