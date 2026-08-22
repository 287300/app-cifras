// Estado do app em memória, carregado do IndexedDB, com aviso de mudança
// para as telas re-renderizarem. Também exporta e importa o backup completo.

import { db, newId, type Settings, type Show, type Song } from './db.ts'

export type { Show, ShowItem, Song } from './db.ts'

type Listener = () => void

class Store {
  songs = new Map<string, Song>()
  shows = new Map<string, Show>()
  settings: Settings = { fontScale: 1 }
  ready = false

  private listeners = new Set<Listener>()

  async init(): Promise<void> {
    const [songs, shows, kv] = await Promise.all([db.getAllSongs(), db.getAllShows(), db.getKv('settings')])
    this.songs = new Map(songs.map((s) => [s.id, s]))
    this.shows = new Map(shows.map((s) => [s.id, s]))
    if (kv && typeof kv.value === 'object' && kv.value) this.settings = { ...this.settings, ...(kv.value as Settings) }
    this.ready = true
    this.emit()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  // ---------- músicas ----------

  songList(): Song[] {
    return [...this.songs.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  }

  searchSongs(query: string): Song[] {
    const q = normalize(query)
    if (!q) return this.songList()
    return this.songList().filter((s) => normalize(s.title + ' ' + s.artist).includes(q))
  }

  async addSong(data: { title: string; artist: string; tom: string; body: string; sourceUrl?: string }): Promise<Song> {
    const now = Date.now()
    const song: Song = {
      id: newId(),
      title: data.title.trim() || 'Sem título',
      artist: data.artist.trim(),
      tom: data.tom.trim(),
      body: data.body,
      semitones: 0,
      scrollSeconds: 180,
      notes: '',
      ...(data.sourceUrl ? { sourceUrl: data.sourceUrl } : {}),
      createdAt: now,
      updatedAt: now,
    }
    this.songs.set(song.id, song)
    await db.putSong(song)
    this.emit()
    return song
  }

  async updateSong(id: string, patch: Partial<Song>): Promise<void> {
    const cur = this.songs.get(id)
    if (!cur) return
    const next = { ...cur, ...patch, id, updatedAt: Date.now() }
    this.songs.set(id, next)
    await db.putSong(next)
    this.emit()
  }

  async deleteSong(id: string): Promise<void> {
    this.songs.delete(id)
    await db.deleteSong(id)
    for (const show of this.shows.values()) {
      if (show.items.some((i) => i.songId === id)) {
        const next = { ...show, items: show.items.filter((i) => i.songId !== id), updatedAt: Date.now() }
        this.shows.set(show.id, next)
        await db.putShow(next)
      }
    }
    this.emit()
  }

  // ---------- shows ----------

  showList(): Show[] {
    return [...this.shows.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }

  async addShow(data: { name: string; date: string }): Promise<Show> {
    const now = Date.now()
    const show: Show = {
      id: newId(),
      name: data.name.trim() || 'Show',
      date: data.date,
      items: [],
      createdAt: now,
      updatedAt: now,
    }
    this.shows.set(show.id, show)
    await db.putShow(show)
    this.emit()
    return show
  }

  async updateShow(id: string, patch: Partial<Show>): Promise<void> {
    const cur = this.shows.get(id)
    if (!cur) return
    const next = { ...cur, ...patch, id, updatedAt: Date.now() }
    this.shows.set(id, next)
    await db.putShow(next)
    this.emit()
  }

  async deleteShow(id: string): Promise<void> {
    this.shows.delete(id)
    await db.deleteShow(id)
    this.emit()
  }

  // ---------- ajustes ----------

  async setSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await db.putKv('settings', this.settings)
    this.emit()
  }

  // ---------- backup ----------

  exportData(): string {
    return JSON.stringify(
      {
        app: 'cifras',
        version: 1,
        exportedAt: new Date().toISOString(),
        songs: [...this.songs.values()],
        shows: [...this.shows.values()],
        settings: this.settings,
      },
      null,
      1
    )
  }

  async importData(json: string): Promise<{ addedSongs: number; updatedSongs: number; skipped: number; addedShows: number }> {
    const data = JSON.parse(json) as { app?: string; songs?: Song[]; shows?: Show[]; settings?: Settings }
    if (data.app !== 'cifras' || !Array.isArray(data.songs)) throw new Error('Arquivo não é um backup do Cifras')
    let addedSongs = 0
    let updatedSongs = 0
    let skipped = 0
    for (const song of data.songs) {
      const cur = this.songs.get(song.id)
      if (!cur) {
        this.songs.set(song.id, song)
        await db.putSong(song)
        addedSongs++
      } else if ((song.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
        this.songs.set(song.id, song)
        await db.putSong(song)
        updatedSongs++
      } else {
        skipped++
      }
    }
    let addedShows = 0
    for (const show of data.shows ?? []) {
      const cur = this.shows.get(show.id)
      if (!cur || (show.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
        if (!cur) addedShows++
        this.shows.set(show.id, show)
        await db.putShow(show)
      }
    }
    if (data.settings) await this.setSettings(data.settings)
    this.emit()
    return { addedSongs, updatedSongs, skipped, addedShows }
  }
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim()
}

export const store = new Store()
