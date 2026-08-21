import { describe, it, expect } from 'bun:test'
import { parseCifra, renderChordLine, uniqueChords } from './parse.ts'
import { transposeSong } from './transpose.ts'

// Cifra realista no formato de colagem do Cifra Club (letra genérica própria).
const FIXTURE = `\t        Minha Cancao

Tom: G
Afinação: E A D G B E

[Intro]  G  D/F#  Em  C

[Verso 1]
G                D/F#
Quando o dia clareia la fora
Em             C
O vento traz a memoria
G        D          C   (x2)
E a casa se enche de luz


[Refrão]
C       D        G    Em
Vem cantar comigo agora
C       D        G
Que o tempo nao demora

e|--3--2--0-------|
B|-------0--1--3--|
`

describe('parser de cifra colada', () => {
  const song = parseCifra(FIXTURE)

  it('detecta o tom e descarta linhas de metadados', () => {
    expect(song.tom).toBe('G')
    const all = song.blocks.flatMap((b) => b.lines)
    const lyricTexts = all.filter((l) => l.kind === 'lyric').map((l) => (l as { text: string }).text)
    for (const t of lyricTexts) {
      expect(t.includes('Afinação')).toBe(false)
      expect(t.startsWith('Tom:')).toBe(false)
    }
  })

  it('identifica os blocos pelas seções', () => {
    const labels = song.blocks.map((b) => b.label).filter(Boolean)
    expect(labels).toEqual(['Intro', 'Verso 1', 'Refrão'])
  })

  it('linha de acordes vira itens com coluna preservada', () => {
    const intro = song.blocks.find((b) => b.label === 'Intro')!
    const line = intro.lines.find((l) => l.kind === 'chords')!
    if (line.kind !== 'chords') throw new Error('esperava linha de acordes')
    const chords = line.items.filter((i) => i.chord).map((i) => i.text)
    expect(chords).toEqual(['G', 'D/F#', 'Em', 'C'])
  })

  it('letra continua sendo letra', () => {
    const verso = song.blocks.find((b) => b.label === 'Verso 1')!
    const lyrics = verso.lines.filter((l) => l.kind === 'lyric')
    expect(lyrics.length).toBeGreaterThanOrEqual(3)
  })

  it('decoração como (x2) fica na linha de acordes sem virar acorde', () => {
    const verso = song.blocks.find((b) => b.label === 'Verso 1')!
    const linhas = verso.lines.filter((l) => l.kind === 'chords')
    const ultima = linhas[linhas.length - 1]!
    if (ultima.kind !== 'chords') throw new Error('esperava acordes')
    const deco = ultima.items.find((i) => !i.chord)
    expect(deco?.text).toBe('(x2)')
    expect(ultima.items.filter((i) => i.chord).map((i) => i.text)).toEqual(['G', 'D', 'C'])
  })

  it('tablatura passa direto como tab', () => {
    const all = song.blocks.flatMap((b) => b.lines)
    expect(all.filter((l) => l.kind === 'tab')).toHaveLength(2)
  })

  it('lista os acordes únicos da música na ordem de aparição', () => {
    expect(uniqueChords(song)).toEqual(['G', 'D/F#', 'Em', 'C', 'D'])
  })
})

describe('render e transposição da música inteira', () => {
  it('render preserva as colunas da colagem', () => {
    const song = parseCifra('G        D\nUma frase qualquer aqui')
    const line = song.blocks[0]!.lines[0]!
    if (line.kind !== 'chords') throw new Error('esperava acordes')
    expect(renderChordLine(line)).toBe('G        D')
  })

  it('transpõe a música inteira mantendo alinhamento e decoração', () => {
    const song = parseCifra('Tom: G\nG        D/F#   (x2)\nUma frase qualquer aqui')
    const up = transposeSong(song, 2)
    expect(up.tom).toBe('A')
    const line = up.blocks[0]!.lines[0]!
    if (line.kind !== 'chords') throw new Error('esperava acordes')
    expect(renderChordLine(line)).toBe('A        E/G#   (x2)')
  })

  it('tom com bemóis força acordes com bemóis', () => {
    const song = parseCifra('Tom: A\nA  E  F#m  D\nLetra de exemplo')
    const up = transposeSong(song, 1)
    expect(up.tom).toBe('Bb')
    const line = up.blocks[0]!.lines[0]!
    if (line.kind !== 'chords') throw new Error('esperava acordes')
    expect(line.items.filter((i) => i.chord).map((i) => i.text)).toEqual(['Bb', 'F', 'Gm', 'Eb'])
  })
})
