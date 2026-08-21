// Transposição de acordes preservando o sufixo, com grafia
// (sustenidos ou bemóis) escolhida pelo tom de destino.

import { decomposeChord } from './chord.ts'
import { keyUsesFlats, mod12, noteToPc, pcToName, transposeKey } from './notes.ts'
import type { ParsedSong } from './parse.ts'

/** Transpõe um acorde por semitons. O que não é acorde volta intacto. */
export function transposeChord(token: string, semitones: number, useFlats: boolean): string {
  const parts = decomposeChord(token)
  if (!parts) return token
  const rootPc = noteToPc(parts.root)
  if (rootPc === null) return token
  const newRoot = pcToName(mod12(rootPc + semitones), useFlats)
  let out = newRoot + parts.suffix
  if (parts.bass) {
    const bassPc = noteToPc(parts.bass)
    if (bassPc !== null) out += '/' + pcToName(mod12(bassPc + semitones), useFlats)
    else out += '/' + parts.bass
  }
  return out
}

/**
 * Transpõe a música inteira. A grafia dos acordes segue o tom de destino;
 * as colunas originais são preservadas (com espaço mínimo entre acordes
 * quando um nome cresce).
 */
export function transposeSong(song: ParsedSong, semitones: number): ParsedSong {
  const newTom = song.tom ? transposeKey(song.tom, semitones) : null
  const useFlats = newTom ? keyUsesFlats(newTom) : false
  return {
    tom: newTom,
    blocks: song.blocks.map((block) => ({
      label: block.label,
      lines: block.lines.map((line) => {
        if (line.kind !== 'chords') return line
        let cursor = 0
        const items = line.items.map((item, idx) => {
          const text = item.chord ? transposeChord(item.text, semitones, useFlats) : item.text
          const col = idx === 0 ? item.col : Math.max(item.col, cursor + 1)
          cursor = col + text.length
          return { text, col, chord: item.chord }
        })
        return { kind: 'chords' as const, items }
      }),
    })),
  }
}
