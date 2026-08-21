import { describe, it, expect } from 'bun:test'
import { noteToPc, pcToName, transposeKey, keyUsesFlats } from './notes.ts'

describe('notas: nome para classe de altura', () => {
  it('reconhece naturais, sustenidos e bemóis', () => {
    expect(noteToPc('C')).toBe(0)
    expect(noteToPc('C#')).toBe(1)
    expect(noteToPc('Db')).toBe(1)
    expect(noteToPc('E')).toBe(4)
    expect(noteToPc('Bb')).toBe(10)
    expect(noteToPc('F##')).toBe(7)
    expect(noteToPc('Cb')).toBe(11)
  })
  it('rejeita o que não é nota', () => {
    expect(noteToPc('H')).toBeNull()
    expect(noteToPc('Casa')).toBeNull()
  })
})

describe('notas: classe de altura para nome', () => {
  it('escreve com sustenido ou bemol conforme pedido', () => {
    expect(pcToName(1, false)).toBe('C#')
    expect(pcToName(1, true)).toBe('Db')
    expect(pcToName(10, false)).toBe('A#')
    expect(pcToName(10, true)).toBe('Bb')
    expect(pcToName(7, true)).toBe('G')
  })
})

describe('tons: transposição com a grafia usual da música popular', () => {
  it('tons maiores', () => {
    expect(transposeKey('G', 2)).toBe('A')
    expect(transposeKey('C', 1)).toBe('Db')
    expect(transposeKey('G', -2)).toBe('F')
    expect(transposeKey('E', 4)).toBe('Ab')
    expect(transposeKey('B', 1)).toBe('C')
    expect(transposeKey('C', 12)).toBe('C')
  })
  it('tons menores', () => {
    expect(transposeKey('Em', 1)).toBe('Fm')
    expect(transposeKey('Am', 2)).toBe('Bm')
    expect(transposeKey('Cm', -1)).toBe('Bm')
    expect(transposeKey('F#m', 2)).toBe('G#m')
    expect(transposeKey('Dm', 12)).toBe('Dm')
  })
})

describe('tons: preferência por bemóis', () => {
  it('tons com bemóis na armadura pedem bemóis', () => {
    expect(keyUsesFlats('F')).toBe(true)
    expect(keyUsesFlats('Bb')).toBe(true)
    expect(keyUsesFlats('Eb')).toBe(true)
    expect(keyUsesFlats('Dm')).toBe(true)
    expect(keyUsesFlats('Gm')).toBe(true)
    expect(keyUsesFlats('Cm')).toBe(true)
    expect(keyUsesFlats('Ebm')).toBe(true)
  })
  it('tons com sustenidos ou sem acidentes pedem sustenidos', () => {
    expect(keyUsesFlats('C')).toBe(false)
    expect(keyUsesFlats('G')).toBe(false)
    expect(keyUsesFlats('E')).toBe(false)
    expect(keyUsesFlats('F#m')).toBe(false)
    expect(keyUsesFlats('Am')).toBe(false)
    expect(keyUsesFlats('Bm')).toBe(false)
  })
})
