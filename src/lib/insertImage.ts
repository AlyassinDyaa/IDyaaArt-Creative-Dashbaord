import type { Editor } from '@tiptap/react'
import { api } from './api'

// Insert an image into the editor. Prefers uploading to R2 and referencing the URL
// (keeps documents small); falls back to embedding a base64 data URL when R2 isn't
// configured, so image insertion always works.
export async function insertImageFromFile(editor: Editor, file: File) {
  try {
    const url = await api.uploadImage(file)
    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
      return
    }
  } catch {
    // network/server error → fall through to embedding
  }
  const reader = new FileReader()
  reader.onload = () => editor.chain().focus().setImage({ src: reader.result as string }).run()
  reader.readAsDataURL(file)
}
