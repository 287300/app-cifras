// Desenhos de acorde para violão: dicionário de shapes abertos consagrados
// e, quando não existe forma aberta, shape móvel com pestana (formas de E e A).
// Todo acorde reconhecível ganha um desenho: extensões caem na família
// mais próxima (o diagrama mostra a base; as notas completas vêm do chordNotes).

import { decomposeChord } from './chord.ts'
import { suffixToIntervals } from './chordNotes.ts'
import { mod12, noteToPc, pcToName } from './notes.ts'

export interface GuitarShape {
  /** 6 cordas, da 6ª (E grave) à 1ª (e aguda); -1 não toca, 0 solta. Casas absolutas. */
  frets: number[]
  /** Pestana, quando houver: casa e intervalo de cordas (índices 0..5). */
  barre?: { fret: number; from: number; to: number }
}

type Family = 'maj' | 'm' | '7' | 'm7' | 'maj7' | 'sus4' | 'sus2' | 'dim7' | 'm7b5' | 'aug' | '5'

const OPEN: Record<string, number[]> = {
  'C|maj': [-1, 3, 2, 0, 1, 0],
  'A|maj': [-1, 0, 2, 2, 2, 0],
  'G|maj': [3, 2, 0, 0, 0, 3],
  'E|maj': [0, 2, 2, 1, 0, 0],
  'D|maj': [-1, -1, 0, 2, 3, 2],
  'A|m': [-1, 0, 2, 2, 1, 0],
  'E|m': [0, 2, 2, 0, 0, 0],
  'D|m': [-1, -1, 0, 2, 3, 1],
  'A|7': [-1, 0, 2, 0, 2, 0],
  'B|7': [-1, 2, 1, 2, 0, 2],
  'C|7': [-1, 3, 2, 3, 1, 0],
  'D|7': [-1, -1, 0, 2, 1, 2],
  'E|7': [0, 2, 0, 1, 0, 0],
  'G|7': [3, 2, 0, 0, 0, 1],
  'A|m7': [-1, 0, 2, 0, 1, 0],
  'E|m7': [0, 2, 2, 0, 3, 0],
  'D|m7': [-1, -1, 0, 2, 1, 1],
  'C|maj7': [-1, 3, 2, 0, 0, 0],
  'A|maj7': [-1, 0, 2, 1, 2, 0],
  'D|maj7': [-1, -1, 0, 2, 2, 2],
  'G|maj7': [3, 2, 0, 0, 0, 2],
  'F|maj7': [-1, -1, 3, 2, 1, 0],
  'A|sus4': [-1, 0, 2, 2, 3, 0],
  'D|sus4': [-1, -1, 0, 2, 3, 3],
  'E|sus4': [0, 2, 2, 2, 0, 0],
  'A|sus2': [-1, 0, 2, 2, 0, 0],
  'D|sus2': [-1, -1, 0, 2, 3, 0],
  'E|5': [0, 2, 2, -1, -1, -1],
  'A|5': [-1, 0, 2, 2, -1, -1],
}

// Formas móveis: deslocamentos a partir da casa da pestana (f) e pestana coberta.
interface Movable {
  string: 'E' | 'A' // corda da raiz
  offsets: (number | null)[] // null = não toca; 0 = na pestana
  barre: { from: number; to: number } | null
}

const MOVABLE: Record<string, Movable[]> = {
  maj: [
    { string: 'E', offsets: [0, 2, 2, 1, 0, 0], barre: { from: 0, to: 5 } },
    { string: 'A', offsets: [null, 0, 2, 2, 2, 0], barre: { from: 1, to: 5 } },
  ],
  m: [
    { string: 'E', offsets: [0, 2, 2, 0, 0, 0], barre: { from: 0, to: 5 } },
    { string: 'A', offsets: [null, 0, 2, 2, 1, 0], barre: { from: 1, to: 5 } },
  ],
  '7': [
    { string: 'E', offsets: [0, 2, 0, 1, 0, 0], barre: { from: 0, to: 5 } },
    { string: 'A', offsets: [null, 0, 2, 0, 2, 0], barre: { from: 1, to: 5 } },
  ],
  m7: [
    { string: 'E', offsets: [0, 2, 0, 0, 0, 0], barre: { from: 0, to: 5 } },
    { string: 'A', offsets: [null, 0, 2, 0, 1, 0], barre: { from: 1, to: 5 } },
  ],
  maj7: [
    { string: 'E', offsets: [0, null, 1, 1, 0, null], barre: null },
    { string: 'A', offsets: [null, 0, 2, 1, 2, 0], barre: { from: 1, to: 5 } },
  ],
  sus4: [
    { string: 'E', offsets: [0, 2, 2, 2, 0, 0], barre: { from: 0, to: 5 } },
    { string: 'A', offsets: [null, 0, 2, 2, 3, 0], barre: { from: 1, to: 5 } },
  ],
  sus2: [{ string: 'A', offsets: [null, 0, 2, 2, 0, 0], barre: { from: 1, to: 5 } }],
  aug: [{ string: 'A', offsets: [null, 0, 3, 2, 2, null], barre: null }],
  m7b5: [{ string: 'A', offsets: [null, 0, 1, 0, 1, null], barre: null }],
  '5': [
    { string: 'E', offsets: [0, 2, 2, null, null, null], barre: null },
    { string: 'A', offsets: [null, 0, 2, 2, null, null], barre: null },
  ],
}

/** Família de shape a partir dos intervalos do acorde. */
function classify(intervals: number[]): Family {
  const has = (n: number) => intervals.includes(n)
  if (has(8) && has(4)) return 'aug'
  const majorThird = has(4)
  const minorThird = !majorThird && has(3)
  if (minorThird && has(6)) {
    if (has(10)) return 'm7b5'
    return 'dim7'
  }
  if (minorThird) return has(10) ? 'm7' : 'm'
  if (majorThird) {
    if (has(11)) return 'maj7'
    if (has(10)) return '7'
    return 'maj'
  }
  if (has(5)) return 'sus4'
  if (has(2)) return 'sus2'
  return '5'
}

const E_PC = 4
const A_PC = 9
const D_PC = 2

/** Desenho de violão para o acorde; null apenas se o nome não for um acorde. */
export function guitarShape(chordName: string): GuitarShape | null {
  const parts = decomposeChord(chordName)
  if (!parts) return null
  const pc = noteToPc(parts.root)
  if (pc === null) return null
  const family = classify(suffixToIntervals(parts.suffix))

  // dim7: shape simétrico com raiz na corda Ré
  if (family === 'dim7') {
    let f = mod12(pc - D_PC) % 3
    if (f === 0) f = 3
    return { frets: [-1, -1, f, f + 1, f, f + 1] }
  }

  const rootSharp = pcToName(pc, false)
  const open = OPEN[rootSharp + '|' + family]
  if (open) return { frets: [...open] }

  const options = MOVABLE[family] ?? MOVABLE['maj']!
  let best: { fret: number; mov: Movable } | null = null
  for (const mov of options) {
    const base = mov.string === 'E' ? E_PC : A_PC
    let f = mod12(pc - base)
    if (f === 0) f = 12
    if (!best || f < best.fret) best = { fret: f, mov }
  }
  const { fret, mov } = best!
  const frets = mov.offsets.map((o) => (o === null ? -1 : fret + o))
  const shape: GuitarShape = { frets }
  if (mov.barre) shape.barre = { fret, from: mov.barre.from, to: mov.barre.to }
  return shape
}
