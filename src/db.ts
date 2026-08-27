// Persistência local no iPad: IndexedDB com uma camada fina de Promises.
// Stores: songs (músicas), shows (setlists) e kv (ajustes).

export interface Song {
  id: string
  title: string
  artist: string
  tom: string
  body: string
  semitones: number
  scrollSeconds: number
  notes: string
  sourceUrl?: string
  videoId?: string // clipe do YouTube escolhido para ensaiar junto
  createdAt: number
  updatedAt: number
}

export interface ShowItem {
  songId: string
  semitones?: number
}

export interface Show {
  id: string
  name: string
  date: string
  items: ShowItem[]
  createdAt: number
  updatedAt: number
}

export interface Settings {
  fontScale: number
}

const DB_NAME = 'cifras'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('shows')) db.createObjectStore('shows', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export const db = {
  getAllSongs: () => tx<Song[]>('songs', 'readonly', (s) => s.getAll() as IDBRequest<Song[]>),
  putSong: (song: Song) => tx('songs', 'readwrite', (s) => s.put(song)),
  deleteSong: (id: string) => tx('songs', 'readwrite', (s) => s.delete(id)),
  getAllShows: () => tx<Show[]>('shows', 'readonly', (s) => s.getAll() as IDBRequest<Show[]>),
  putShow: (show: Show) => tx('shows', 'readwrite', (s) => s.put(show)),
  deleteShow: (id: string) => tx('shows', 'readwrite', (s) => s.delete(id)),
  getKv: (key: string) => tx<{ key: string; value: unknown } | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<{ key: string; value: unknown } | undefined>),
  putKv: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put({ key, value })),
}

export function newId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
