// Notas e tons: aritmética de classes de altura (0 a 11) e grafia
// (sustenidos ou bemóis) no padrão da música popular brasileira.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const NOTE_RE = /^([A-G])(##|bb|#|b)?$/

/** Nome de nota ("C#", "Bb", "F##") para classe de altura 0..11; null se não for nota. */
export function noteToPc(name: string): number | null {
  const m = NOTE_RE.exec(name.trim())
  if (!m) return null
  let pc = LETTER_PC[m[1]!]!
  for (const ch of m[2] ?? '') pc += ch === '#' ? 1 : -1
  return mod12(pc)
}

/** Classe de altura para nome, com bemóis ou sustenidos. */
export function pcToName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!
}

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12
}

// Grafia usual de cada tom (menos acidentes na armadura):
// maiores: Db(5b) em vez de C#(7#), F#(6#) em vez de Gb(6b), B(5#) em vez de Cb(7b)
const MAJOR_SPELL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const
// menores: Ebm(6b) em vez de D#m(6#), G#m(5#) em vez de Abm(7b), Bbm(5b) em vez de A#m(7#)
const MINOR_SPELL = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'] as const

const KEY_RE = /^([A-G](?:##|bb|#|b)?)(m)?$/

export function parseKey(key: string): { pc: number; minor: boolean } | null {
  const m = KEY_RE.exec(key.trim())
  if (!m) return null
  const pc = noteToPc(m[1]!)
  if (pc === null) return null
  return { pc, minor: !!m[2] }
}

/** Transpõe um tom ("G", "Em") por semitons, com a grafia usual. */
export function transposeKey(key: string, semitones: number): string {
  const k = parseKey(key)
  if (!k) return key
  const pc = mod12(k.pc + semitones)
  return k.minor ? MINOR_SPELL[pc]! : MAJOR_SPELL[pc]!
}

// Menores naturais cuja armadura tem bemóis: Dm, Gm, Cm, Fm
const FLAT_MINOR_NATURAL = new Set([2, 7, 0, 5])

/** Um tom pede acordes grafados com bemóis? (F, Bb..., Dm, Gm...) */
export function keyUsesFlats(key: string): boolean {
  const k = parseKey(key)
  if (!k) return false
  if (key.includes('b')) return true
  if (key.includes('#')) return false
  const spelled = k.minor ? MINOR_SPELL[k.pc]! : MAJOR_SPELL[k.pc]!
  if (spelled.includes('b')) return true
  if (spelled.includes('#')) return false
  return k.minor ? FLAT_MINOR_NATURAL.has(k.pc) : k.pc === 5 // F maior
}
