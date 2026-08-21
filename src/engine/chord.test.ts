import { describe, it, expect } from 'bun:test'
import { isChordToken, decomposeChord } from './chord.ts'

describe('acorde: reconhecimento de token', () => {
  it('aceita os acordes comuns das cifras brasileiras', () => {
    const ok = [
      'C', 'Am', 'D7', 'C#m7', 'Bb7M', 'G/B', 'D/F#', 'A7(9)', 'Em7(5-)',
      'Gsus4', 'C°', 'Cº7', 'F#m7(11)', 'C7/9', 'Cadd9', 'Caug', 'Cdim',
      'C+', 'C6(9)', 'E7(#9)', 'Ab7M', 'Dm6', 'B4(7)', 'Gb', 'A2',
    ]
    for (const t of ok) expect(isChordToken(t)).toBe(true)
  })
  it('rejeita palavras e sujeira', () => {
    const bad = ['Casa', 'Amor', 'Ave', 'De', 'Do', 'Bem', 'Fim', 'x2', '2x', '|', '(x2)', 'la', 'Coração', 'Deus']
    for (const t of bad) expect(isChordToken(t)).toBe(false)
  })
})

describe('acorde: decomposição em raiz, sufixo e baixo', () => {
  it('separa raiz e sufixo', () => {
    expect(decomposeChord('Am7')).toEqual({ root: 'A', suffix: 'm7', bass: null })
    expect(decomposeChord('Bb7M(9)')).toEqual({ root: 'Bb', suffix: '7M(9)', bass: null })
    expect(decomposeChord('C')).toEqual({ root: 'C', suffix: '', bass: null })
  })
  it('separa baixo invertido quando a parte após a barra é nota', () => {
    expect(decomposeChord('D/F#')).toEqual({ root: 'D', suffix: '', bass: 'F#' })
    expect(decomposeChord('C7M/G')).toEqual({ root: 'C', suffix: '7M', bass: 'G' })
  })
  it('mantém extensões numéricas com barra no sufixo', () => {
    expect(decomposeChord('C7/9')).toEqual({ root: 'C', suffix: '7/9', bass: null })
  })
  it('devolve null para o que não é acorde', () => {
    expect(decomposeChord('Casa')).toBeNull()
    expect(decomposeChord('x2')).toBeNull()
  })
})
