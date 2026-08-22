import { describe, it, expect } from 'bun:test'
import { parseCifra } from './parse.ts'
import { guessTom } from './guessTom.ts'

// Heurística clássica de cifra brasileira: a música cadencia no tom.
// O último acorde (e, como apoio, o primeiro) aponta a tônica.

describe('adivinhar o tom pelos acordes', () => {
  it('música que termina na tônica maior', () => {
    const song = parseCifra('[Intro] G  D  Em  C\n\nG      D     C\nLetra de exemplo\nC   D    G\nFinal da música')
    expect(guessTom(song)).toBe('G')
  })
  it('música menor', () => {
    const song = parseCifra('Am     F      C     G\nLinha de exemplo\nF   G   Am\nFim')
    expect(guessTom(song)).toBe('Am')
  })
  it('baixo invertido no fim usa o acorde, não o baixo', () => {
    const song = parseCifra('D    A/C#   Bm\nLinha\nG   A   D/F#\nFim')
    expect(guessTom(song)).toBe('D')
  })
  it('quando o texto declara o tom, o declarado vence', () => {
    const song = parseCifra('Tom: Bb\nF   Gm   Bb\nLinha final')
    expect(song.tom).toBe('Bb')
  })
  it('sem acordes: null', () => {
    expect(guessTom(parseCifra('só letra, nada de acordes'))).toBeNull()
  })
})
