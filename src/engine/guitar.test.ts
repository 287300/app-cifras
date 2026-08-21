import { describe, it, expect } from 'bun:test'
import { guitarShape } from './guitar.ts'

// Fonte de verdade independente: diagramas consagrados de violão.
// frets: 6 cordas da 6ª (E grave) à 1ª (e aguda); -1 não toca, 0 solta.

describe('shapes abertos clássicos', () => {
  it('C x32010', () => {
    expect(guitarShape('C')!.frets).toEqual([-1, 3, 2, 0, 1, 0])
  })
  it('E 022100', () => {
    expect(guitarShape('E')!.frets).toEqual([0, 2, 2, 1, 0, 0])
  })
  it('Am x02210', () => {
    expect(guitarShape('Am')!.frets).toEqual([-1, 0, 2, 2, 1, 0])
  })
  it('D xx0232', () => {
    expect(guitarShape('D')!.frets).toEqual([-1, -1, 0, 2, 3, 2])
  })
  it('B7 x21202', () => {
    expect(guitarShape('B7')!.frets).toEqual([-1, 2, 1, 2, 0, 2])
  })
  it('C7M x32000', () => {
    expect(guitarShape('C7M')!.frets).toEqual([-1, 3, 2, 0, 0, 0])
  })
})

describe('pestana móvel quando não há shape aberto', () => {
  it('F = forma de E na casa 1, com pestana', () => {
    const s = guitarShape('F')!
    expect(s.frets).toEqual([1, 3, 3, 2, 1, 1])
    expect(s.barre).toEqual({ fret: 1, from: 0, to: 5 })
  })
  it('F#m = forma de Em na casa 2', () => {
    expect(guitarShape('F#m')!.frets).toEqual([2, 4, 4, 2, 2, 2])
  })
  it('Bm = forma de Am na casa 2', () => {
    const s = guitarShape('Bm')!
    expect(s.frets).toEqual([-1, 2, 4, 4, 3, 2])
    expect(s.barre).toEqual({ fret: 2, from: 1, to: 5 })
  })
  it('C#m7 = forma de Am7 na casa 4', () => {
    expect(guitarShape('C#m7')!.frets).toEqual([-1, 4, 6, 4, 5, 4])
  })
  it('G# = forma de E na casa 4', () => {
    expect(guitarShape('G#')!.frets).toEqual([4, 6, 6, 5, 4, 4])
  })
})

describe('nenhum acorde do repertório fica sem desenho', () => {
  it('baixo invertido usa o shape do acorde base', () => {
    expect(guitarShape('D/F#')!.frets).toEqual(guitarShape('D')!.frets)
  })
  it('extensões caem na família mais próxima', () => {
    const reais = ['G', 'D/F#', 'Em', 'C', 'D', 'Am7', 'C7M', 'E7(#9)', 'Bb', 'Ebm', 'F#m7(11)', 'Gsus4', 'A7(9)', 'Cº', 'Bm7(5-)', 'Caug', 'D6', 'Em9']
    for (const c of reais) {
      const s = guitarShape(c)
      expect(s).toBeDefined()
      expect(s!.frets).toHaveLength(6)
    }
  })
})
