// Renderização da cifra: blocos, linhas de acorde alinhadas em monoespaçada,
// acordes tocáveis (abrem o desenho), observações destacadas.

import { parseCifra, uniqueChords, type ParsedSong } from '../engine/parse.ts'
import { keyUsesFlats, transposeKey } from '../engine/notes.ts'
import { transposeSong } from '../engine/transpose.ts'
import type { Song } from '../store.ts'
import { h } from './dom.ts'
import { openChordSheet } from './chordSheet.ts'

export interface CifraRender {
  el: HTMLElement
  parsed: ParsedSong
  displayTom: string | null
  useFlats: boolean
  chords: string[]
}

/** Monta a cifra da música já no tom de exibição (semitones aplicados). */
export function renderCifra(song: Song, semitones: number): CifraRender {
  const base = parseCifra(song.body)
  if (!base.tom && song.tom) base.tom = song.tom
  const parsed = semitones !== 0 ? transposeSong(base, semitones) : base
  const displayTom = parsed.tom ?? (song.tom ? transposeKey(song.tom, semitones) : null)
  const useFlats = displayTom ? keyUsesFlats(displayTom) : false

  const root = h('div', { className: 'cifra' })

  if (song.notes.trim()) {
    root.append(h('div', { className: 'obs' }, song.notes.trim()))
  }

  for (const block of parsed.blocks) {
    if (block.label) root.append(h('div', { className: 'sec' }, block.label))
    for (const line of block.lines) {
      if (line.kind === 'blank') {
        root.append(h('div', null, ' '))
        continue
      }
      if (line.kind === 'lyric') {
        root.append(h('pre', null, line.text))
        continue
      }
      if (line.kind === 'tab') {
        root.append(h('div', { className: 'ln-tab' }, line.text))
        continue
      }
      // linha de acordes: reconstrói com espaçamento e spans tocáveis
      const lineEl = h('div', { className: 'ln-chords' })
      let cursor = 0
      for (const item of line.items) {
        const col = Math.max(item.col, cursor === 0 ? 0 : cursor + 1)
        if (col > cursor) lineEl.append(' '.repeat(col - cursor))
        if (item.chord) {
          lineEl.append(
            h(
              'span',
              {
                className: 'chord',
                onClick: (e: Event) => {
                  e.stopPropagation()
                  openChordSheet(item.text, useFlats)
                },
              },
              item.text
            )
          )
        } else {
          lineEl.append(item.text)
        }
        cursor = col + item.text.length
      }
      root.append(lineEl)
    }
  }

  return { el: root, parsed, displayTom, useFlats, chords: uniqueChords(parsed) }
}
