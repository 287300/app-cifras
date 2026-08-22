// Adivinha o tom pelos acordes quando a cifra não declara "Tom:".
// Heurística de cifra popular: a música cadencia na tônica; o último
// acorde pesa mais, o primeiro desempata.

import { decomposeChord } from './chord.ts'
import type { ParsedSong } from './parse.ts'

function chordToKey(token: string): string | null {
  const parts = decomposeChord(token)
  if (!parts) return null
  const minor = /^m(?!aj)/.test(parts.suffix)
  return parts.root + (minor ? 'm' : '')
}

/** Tom provável da música a partir dos acordes; null se não houver acordes. */
export function guessTom(song: ParsedSong): string | null {
  const chords: string[] = []
  for (const block of song.blocks) {
    for (const line of block.lines) {
      if (line.kind !== 'chords') continue
      for (const item of line.items) if (item.chord) chords.push(item.text)
    }
  }
  if (chords.length === 0) return null

  const last = chordToKey(chords[chords.length - 1]!)
  const first = chordToKey(chords[0]!)
  if (last && first === last) return last
  // último acorde manda; se ele for "estranho" (não decompõe), cai para o primeiro
  return last ?? first
}
