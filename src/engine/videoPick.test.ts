import { describe, expect, test } from 'bun:test'
import { escolheVideo, isCanalDoArtista, normaliza, tituloBate, type VideoLike } from './videoPick.ts'

const hit = (id: string, title: string, channel: string, length = '3:56'): VideoLike => ({ id, title, channel, length })

describe('normaliza', () => {
  test('tira acento, pontuação e caixa', () => {
    expect(normaliza('Comédia Romântica')).toBe('comedia romantica')
    expect(normaliza("L'Avventura")).toBe('l avventura')
  })
})

describe('canal do artista', () => {
  test('reconhece o canal, o VEVO e o canal automático "- Tema"', () => {
    expect(isCanalDoArtista('Legião Urbana', 'Legião Urbana')).toBe(true)
    expect(isCanalDoArtista('Legiao Urbana - Tema', 'Legião Urbana')).toBe(true)
    expect(isCanalDoArtista('Legiao Urbana - Topic', 'Legião Urbana')).toBe(true)
    expect(isCanalDoArtista('legiaourbanaVEVO', 'Legião Urbana')).toBe(true)
  })

  test('não confunde com fã, cover e outra banda', () => {
    expect(isCanalDoArtista('Bille Cipriani', 'Legião Urbana')).toBe(false)
    expect(isCanalDoArtista('Para Sempre Renato Russo', 'Legião Urbana')).toBe(false)
    expect(isCanalDoArtista('Capital Inicial', 'Legião Urbana')).toBe(false)
  })
})

describe('título bate com a música', () => {
  test('aceita variações de acento e de caixa', () => {
    expect(tituloBate('Natalia', 'Natália')).toBe(true)
    expect(tituloBate('Legião Urbana - As Flores Do Mal', 'As Flores do Mal')).toBe(true)
  })

  test('recusa outra música do mesmo artista', () => {
    expect(tituloBate('Soul Parsifal', 'Mil Pedaços')).toBe(false)
  })
})

describe('escolha automática', () => {
  test('prefere o canal oficial mesmo quando ele não é o primeiro', () => {
    const hits = [
      hit('aaaaaaaaaaa', 'Legião Urbana - Marcianos invadem a Terra', 'Bille Cipriani'),
      hit('bbbbbbbbbbb', 'Marcianos Invadem A Terra', 'Legião Urbana'),
    ]
    expect(escolheVideo(hits, 'Marcianos Invadem a Terra', 'Legião Urbana')?.id).toBe('bbbbbbbbbbb')
  })

  test('não pega cover, aula nem karaokê', () => {
    const hits = [
      hit('ccccccccccc', 'Natália - Legião Urbana (cover acústico)', 'Fulano'),
      hit('ddddddddddd', 'Como tocar Natália - Legião Urbana', 'Aula de Violão'),
    ]
    expect(escolheVideo(hits, 'Natália', 'Legião Urbana')).toBeNull()
  })

  test('sem nada do artista, prefere ficar sem vídeo a chutar', () => {
    const hits = [
      hit('eeeeeeeeeee', 'Somos tão Jovens - Fátima', 'paulohenryqe3'),
      hit('fffffffffff', 'CAPITAL INICIAL | FÁTIMA - ACÚSTICO MTV', 'Capital Inicial'),
    ]
    expect(escolheVideo(hits, 'Fátima', 'Legião Urbana')).toBeNull()
  })

  test('sem canal oficial, aceita quem traz o artista no título', () => {
    const hits = [hit('ggggggggggg', 'Legião Urbana - Fátima (áudio oficial)', 'Acervo')]
    expect(escolheVideo(hits, 'Fátima', 'Legião Urbana')?.id).toBe('ggggggggggg')
  })

  test('lista vazia não quebra', () => {
    expect(escolheVideo([], 'Natália', 'Legião Urbana')).toBeNull()
  })
})
