// Vídeo junto com a cifra: toda música nova entra numa fila e o app procura
// o clipe sozinho, sem travar a tela de quem está salvando.
//
// A fila é serial de propósito (uma busca por vez, com respiro entre elas):
// o assistente de carga pode salvar dez músicas seguidas e não é para
// disparar dez buscas ao mesmo tempo.

import { escolheVideo } from './engine/videoPick.ts'
import { searchVideos } from './importer.ts'
import { store } from './store.ts'

const fila: string[] = []
let rodando = false

/** Enfileira a busca do clipe desta música. Não espera, não atrapalha. */
export function pescaVideo(songId: string): void {
  if (!songId || fila.includes(songId)) return
  fila.push(songId)
  if (!rodando) void roda()
}

async function roda(): Promise<void> {
  rodando = true
  try {
    while (fila.length > 0) {
      const id = fila.shift()
      if (!id) continue
      if (!navigator.onLine) {
        fila.length = 0 // sem sinal: desiste da rodada, o 🎬 continua à mão
        return
      }
      const song = store.songs.get(id)
      if (!song || song.videoId || !song.title) continue
      try {
        const hits = await searchVideos(song.title + ' ' + song.artist)
        const bom = escolheVideo(hits, song.title, song.artist)
        // só grava se ainda estiver sem vídeo (o dono pode ter escolhido no meio tempo)
        const atual = store.songs.get(id)
        if (bom && atual && !atual.videoId) await store.updateSong(id, { videoId: bom.id })
      } catch {
        // sem clipe não é erro de verdade: a cifra é que importa
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    rodando = false
  }
}
