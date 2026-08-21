import { describe, it, expect } from 'bun:test'
import { chordNotes } from './chordNotes.ts'

// Fonte de verdade independente: teoria musical básica.
// C maior = C E G; Cm = C Eb G; C7 = C E G Bb; C7M = C E G B; etc.

function names(chord: string, flats = false): string[] | null {
  const r = chordNotes(chord, flats)
  return r ? r.notes : null
}

describe('notas de cada acorde (fonte para o diagrama de teclado)', () => {
  it('tríades', () => {
    expect(names('C')).toEqual(['C', 'E', 'G'])
    expect(names('Cm', true)).toEqual(['C', 'Eb', 'G'])
    expect(names('Cdim', true)).toEqual(['C', 'Eb', 'Gb'])
    expect(names('C°', true)).toEqual(['C', 'Eb', 'Gb'])
    expect(names('Caug')).toEqual(['C', 'E', 'G#'])
    expect(names('C+')).toEqual(['C', 'E', 'G#'])
    expect(names('Csus4')).toEqual(['C', 'F', 'G'])
    expect(names('Csus2')).toEqual(['C', 'D', 'G'])
    expect(names('C4')).toEqual(['C', 'F', 'G'])
    expect(names('C2')).toEqual(['C', 'D', 'G'])
  })
  it('tétrades e extensões', () => {
    expect(names('C7', true)).toEqual(['C', 'E', 'G', 'Bb'])
    expect(names('C7M')).toEqual(['C', 'E', 'G', 'B'])
    expect(names('Cmaj7')).toEqual(['C', 'E', 'G', 'B'])
    expect(names('Cm7', true)).toEqual(['C', 'Eb', 'G', 'Bb'])
    expect(names('Cm7M')).toEqual(['C', 'D#', 'G', 'B'])
    expect(names('C6')).toEqual(['C', 'E', 'G', 'A'])
    expect(names('Cm6')).toEqual(['C', 'D#', 'G', 'A'])
    expect(names('C9', true)).toEqual(['C', 'E', 'G', 'Bb', 'D'])
    expect(names('C7(9)', true)).toEqual(['C', 'E', 'G', 'Bb', 'D'])
    expect(names('Cadd9')).toEqual(['C', 'E', 'G', 'D'])
    expect(names('Cm7(5-)', true)).toEqual(['C', 'Eb', 'Gb', 'Bb'])
    expect(names('Cº7', true)).toEqual(['C', 'Eb', 'Gb', 'A'])
  })
  it('baixo invertido vem em campo separado', () => {
    expect(chordNotes('C/E')).toEqual({ notes: ['C', 'E', 'G'], bass: 'E' })
    expect(chordNotes('D/F#')).toEqual({ notes: ['D', 'F#', 'A'], bass: 'F#' })
    expect(chordNotes('C')!.bass).toBeNull()
  })
  it('acorde com raiz bemol usa grafia coerente', () => {
    expect(names('Bb', true)).toEqual(['Bb', 'D', 'F'])
    expect(names('Ab7M', true)).toEqual(['Ab', 'C', 'Eb', 'G'])
  })
  it('sufixo desconhecido não quebra: cai na tríade maior', () => {
    const r = chordNotes('Cblablah')
    expect(r).toBeNull() // não é acorde válido, retorna null
    expect(names('C5')).toEqual(['C', 'G']) // power chord: raiz e quinta
  })
})
