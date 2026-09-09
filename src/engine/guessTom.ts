// Adivinha o tom pelos acordes quando a cifra não declara "Tom:".
// Heurística de cifra popular: a música cadencia na tônica; o último
// acorde pesa mais, o primeiro desempata.

import { decomposeChord } from './chord.ts'
import { parseKey } from './notes.ts'
import { parseCifra, type ParsedSong } from './parse.ts'

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

/**
 * O tom que vale para uma cifra que acabou de chegar da internet.
 *
 * Três fontes, da mais confiável para a menos:
 *
 *   1. o tom que a PÁGINA anunciou (só se for um tom que o app entende);
 *   2. o "Tom:" declarado dentro da própria cifra;
 *   3. o palpite pelos acordes (`guessTom`).
 *
 * Nada disso servindo, fica o que o app já tinha (`reserva`).
 *
 * Isto decidia o tom dentro da tela e sem teste (achado Standards 2 da revisão
 * de 04/09). Errar aqui é entregar a música na altura errada, e o músico só
 * descobre quando abre a boca.
 */
export function melhorTom(anunciado: string | null, corpo: string, reserva = ''): string {
  if (anunciado && parseKey(anunciado)) return anunciado
  const lida = parseCifra(corpo)
  if (lida.tom && parseKey(lida.tom)) return lida.tom
  return guessTom(lida) ?? reserva
}
