import { describe, it, expect } from 'bun:test'
import { transposeChord } from './transpose.ts'

describe('transposição de acorde individual', () => {
  it('casos da especificação', () => {
    expect(transposeChord('G', 2, false)).toBe('A')
    expect(transposeChord('Em', 1, false)).toBe('Fm')
    expect(transposeChord('D/F#', 2, false)).toBe('E/G#')
  })
  it('preserva o sufixo intacto', () => {
    expect(transposeChord('C7M(9)', 2, false)).toBe('D7M(9)')
    expect(transposeChord('Am7(11)', -2, false)).toBe('Gm7(11)')
    expect(transposeChord('Gsus4', 5, false)).toBe('Csus4')
  })
  it('respeita a preferência por bemóis do tom de destino', () => {
    expect(transposeChord('A', 1, true)).toBe('Bb')
    expect(transposeChord('F#m7', 1, true)).toBe('Gm7')
    expect(transposeChord('E/G#', 1, true)).toBe('F/A')
    expect(transposeChord('A', 1, false)).toBe('A#')
  })
  it('doze semitons volta ao mesmo acorde', () => {
    for (const c of ['C', 'F#m7', 'Bb7M', 'D/F#', 'E7(#9)']) {
      expect(transposeChord(c, 12, false)).toBe(c.replace('Bb', 'A#'))
    }
  })
  it('o que não é acorde passa intacto', () => {
    expect(transposeChord('x2', 2, false)).toBe('x2')
    expect(transposeChord('|', 2, false)).toBe('|')
  })
})
