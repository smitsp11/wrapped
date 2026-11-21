import type { LocalPreview, MediaFor } from '../convo'
import { api, headers } from './api'

type MediaItem = { hit: number; message: number; id: string }

/** What the preview adds on this Mac (see LocalPreview in convo.ts): your photos in its conversations, from the app. */
export async function loadLocalPreview(wrapId: string): Promise<Omit<LocalPreview, 'packed'>> {
  return { mediaFor: await loadMediaFor(wrapId) }
}

/** A photo is fetched the first time its conversation opens, then kept. null when there are none. */
async function loadMediaFor(wrapId: string): Promise<MediaFor | null> {
  let items: MediaItem[]
  try {
    items = (await api<{ items: MediaItem[] }>(`/api/convo-media?wrap=${encodeURIComponent(wrapId)}`)).items
  } catch {
    return null
  }
  if (!Array.isArray(items) || items.length === 0) return null
  const idAt = new Map(items.map((item) => [`${item.hit}:${item.message}`, item.id]))
  const loaded = new Map<string, Promise<string>>()
  return (hit, message) => {
    const id = idAt.get(`${hit}:${message}`)
    if (!id) return null
    let photo = loaded.get(id)
    if (!photo) {
      // The token goes in a header, which an <img> can't send, so the photo is fetched here and shown from memory.
      photo = fetch(`/api/media/${encodeURIComponent(id)}`, { headers }).then(async (res) => {
        if (!res.ok) throw new Error(`The app answered ${res.status}.`)
        return URL.createObjectURL(await res.blob())
      })
      photo.catch(() => loaded.delete(id)) // try again next time the conversation opens
      loaded.set(id, photo)
    }
    return photo
  }
}
