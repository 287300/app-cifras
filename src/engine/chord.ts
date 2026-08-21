// Reconhecimento e decomposição de nomes de acorde no formato das cifras
// brasileiras: raiz (A a G com acidente), sufixo (m, 7, 7M, sus4, dim, (9)...)
// e baixo invertido após "/" quando a parte final é uma nota.

import { noteToPc } from './notes.ts'

export interface ChordParts {
  root: string
  suffix: string
  bass: string | null
}

const ROOT_RE = /^([A-G](?:##|bb|#|b)?)/

// Palavras-átomo aceitas num sufixo de acorde, na ordem de tentativa
// (as mais longas primeiro para não confundir "maj" com "m").
const SUFFIX_WORDS = ['maj', 'sus', 'dim', 'aug', 'add', 'm', 'M', 'ø', '°', 'º', '+', '-', '#', 'b', '/', '(', ')']

/** O sufixo é composto apenas de átomos válidos de acorde? */
function isValidSuffix(suffix: string): boolean {
  let i = 0
  while (i < suffix.length) {
    const rest = suffix.slice(i)
    const digits = /^[0-9]+/.exec(rest)
    if (digits) {
      i += digits[0].length
      continue
    }
    const word = SUFFIX_WORDS.find((w) => rest.startsWith(w))
    if (!word) return false
    i += word.length
  }
  return true
}

/** Decompõe um token em raiz, sufixo e baixo; null se não for acorde. */
export function decomposeChord(token: string): ChordParts | null {
  const t = token.trim()
  const m = ROOT_RE.exec(t)
  if (!m) return null
  const root = m[1]!
  if (noteToPc(root) === null) return null
  let rest = t.slice(root.length)

  // Baixo invertido: a parte após a ÚLTIMA barra, quando é uma nota.
  let bass: string | null = null
  const slash = rest.lastIndexOf('/')
  if (slash >= 0) {
    const after = rest.slice(slash + 1)
    if (noteToPc(after) !== null) {
      bass = after
      rest = rest.slice(0, slash)
    }
  }

  if (!isValidSuffix(rest)) return null
  return { root, suffix: rest, bass }
}

/** O token é um acorde? ("Am7" sim, "Amor" não) */
export function isChordToken(token: string): boolean {
  return decomposeChord(token) !== null
}
