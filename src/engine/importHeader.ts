// Cabeçalho do botão de importar: as primeiras linhas do texto copiado podem
// trazer "Música: X" e "Artista: Y". Aqui elas viram campos e saem do corpo.

export interface ImportHeader {
  title: string | null
  artist: string | null
  body: string
}

const TITLE_RE = /^\s*(m[úu]sica|t[íi]tulo|song|title)\s*:\s*(.+)$/i
const ARTIST_RE = /^\s*(artista|banda|autor|cantor|artist)\s*:\s*(.+)$/i

/** Só é cabeçalho se estiver nas primeiras linhas, antes de qualquer conteúdo. */
export function extractImportHeader(text: string): ImportHeader {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let title: string | null = null
  let artist: string | null = null
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      if (title === null && artist === null) break
      i++
      continue
    }
    const t = TITLE_RE.exec(line)
    if (t && title === null) {
      title = t[2]!.trim()
      i++
      continue
    }
    const a = ARTIST_RE.exec(line)
    if (a && artist === null) {
      artist = a[2]!.trim()
      i++
      continue
    }
    break
  }
  if (title === null && artist === null) {
    return { title: null, artist: null, body: text }
  }
  return { title, artist, body: lines.slice(i).join('\n').replace(/^\n+/, '') }
}
