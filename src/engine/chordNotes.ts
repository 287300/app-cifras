// Notas que formam cada acorde, a partir do nome cifrado.
// É a fonte do diagrama de teclado e do fallback "mostrar as notas"
// quando não existe desenho de violão pronto.

import { decomposeChord } from './chord.ts'
import { mod12, noteToPc, pcToName } from './notes.ts'

export interface ChordNotesResult {
  notes: string[]
  bass: string | null
}

interface Recipe {
  third: number | null // 4 maior, 3 menor, 5 sus4, 2 sus2, null = sem terça
  fifth: number // 7 justa, 6 diminuta, 8 aumentada
  extra: number[] // demais intervalos em semitons a partir da raiz
}

/** Interpreta o sufixo como intervalos. Tolerante: pedaços desconhecidos são ignorados. */
export function suffixToIntervals(suffix: string): number[] {
  const r: Recipe = { third: 4, fifth: 7, extra: [] }
  let s = suffix

  const eat = (token: string | RegExp): string | null => {
    if (typeof token === 'string') {
      if (s.startsWith(token)) {
        s = s.slice(token.length)
        return token
      }
      return null
    }
    const m = token.exec(s)
    if (m && m.index === 0) {
      s = s.slice(m[0].length)
      return m[0]
    }
    return null
  }

  while (s.length > 0) {
    // menor: "m" que não é "maj"
    if (/^m(?!aj)/.test(s)) {
      eat('m')
      r.third = 3
      continue
    }
    if (eat('maj7') || eat('7M') || eat('M7')) {
      r.extra.push(11)
      continue
    }
    if (eat('maj')) continue
    if (eat('dim7') || eat('°7') || eat('º7')) {
      r.third = 3
      r.fifth = 6
      r.extra.push(9)
      continue
    }
    if (eat('dim') || eat('°') || eat('º')) {
      r.third = 3
      r.fifth = 6
      continue
    }
    if (eat('ø')) {
      r.third = 3
      r.fifth = 6
      r.extra.push(10)
      continue
    }
    if (eat('aug') || eat('+')) {
      r.fifth = 8
      continue
    }
    if (eat('sus4')) {
      r.third = 5
      continue
    }
    if (eat('sus2')) {
      r.third = 2
      continue
    }
    if (eat('sus')) {
      r.third = 5
      continue
    }
    if (eat('add9') || eat('add2')) {
      r.extra.push(2)
      continue
    }
    if (eat('add11') || eat('add4')) {
      r.extra.push(5)
      continue
    }
    if (eat('add')) continue
    // alterações entre parênteses ou soltas
    if (eat('(#5)') || eat('(5+)') || eat('#5') || eat('5+')) {
      r.fifth = 8
      continue
    }
    if (eat('(b5)') || eat('(5-)') || eat('b5') || eat('5-')) {
      r.fifth = 6
      continue
    }
    if (eat('(#9)') || eat('(9+)')) {
      if (!r.extra.includes(10)) r.extra.push(10)
      r.extra.push(3)
      continue
    }
    if (eat('(b9)') || eat('(9-)')) {
      if (!r.extra.includes(10)) r.extra.push(10)
      r.extra.push(1)
      continue
    }
    if (eat('(b13)') || eat('(13-)')) {
      r.extra.push(8)
      continue
    }
    if (eat('(9)') || eat('/9')) {
      r.extra.push(2)
      continue
    }
    if (eat('(11)') || eat('/11')) {
      r.extra.push(5)
      continue
    }
    if (eat('(13)') || eat('/13')) {
      r.extra.push(9)
      continue
    }
    if (eat('13')) {
      r.extra.push(10, 2, 9)
      continue
    }
    if (eat('11')) {
      r.extra.push(10, 2, 5)
      continue
    }
    if (eat('9')) {
      r.extra.push(10, 2)
      continue
    }
    if (eat('7')) {
      r.extra.push(10)
      continue
    }
    if (eat('6')) {
      r.extra.push(9)
      continue
    }
    if (eat('5')) {
      r.third = null // power chord: só raiz e quinta
      continue
    }
    if (eat('4')) {
      r.third = 5
      continue
    }
    if (eat('2')) {
      r.third = 2
      continue
    }
    // pedaço não reconhecido: pula um caractere e segue (tolerância)
    s = s.slice(1)
  }

  const iv = [0]
  if (r.third !== null) iv.push(r.third)
  iv.push(r.fifth)
  for (const e of r.extra) if (!iv.includes(e)) iv.push(e)
  return iv
}

/** Notas do acorde (a partir da raiz, em ordem de intervalo) e baixo separado. */
export function chordNotes(chordName: string, flats = false): ChordNotesResult | null {
  const parts = decomposeChord(chordName)
  if (!parts) return null
  const rootPc = noteToPc(parts.root)
  if (rootPc === null) return null
  const useFlats = flats || parts.root.includes('b')
  const intervals = suffixToIntervals(parts.suffix)
  const notes = intervals.map((i) => {
    if (i === 0) return parts.root
    return pcToName(mod12(rootPc + i), useFlats)
  })
  return { notes, bass: parts.bass }
}
