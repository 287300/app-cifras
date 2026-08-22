import { describe, it, expect } from 'bun:test'
import { extractImportHeader } from './importHeader.ts'

// O botão de importar copia a cifra com um cabeçalho "Música:/Artista:".
// A colagem no app separa o cabeçalho dos campos e deixa só a cifra no corpo.

const COM_CABECALHO = `Música: Natalia
Artista: Legião Urbana

Tom: Am

[Intro] Am  G  F

Am              G
Primeira linha de exemplo
`

describe('cabeçalho de importação', () => {
  it('extrai título e artista e limpa o corpo', () => {
    const r = extractImportHeader(COM_CABECALHO)
    expect(r.title).toBe('Natalia')
    expect(r.artist).toBe('Legião Urbana')
    expect(r.body.includes('Música:')).toBe(false)
    expect(r.body.includes('Artista:')).toBe(false)
    expect(r.body.includes('Tom: Am')).toBe(true)
    expect(r.body.includes('[Intro]')).toBe(true)
  })
  it('aceita variações de rótulo', () => {
    expect(extractImportHeader('Titulo: X\nBanda: Y\n\nG D').title).toBe('X')
    expect(extractImportHeader('Titulo: X\nBanda: Y\n\nG D').artist).toBe('Y')
  })
  it('sem cabeçalho: devolve o texto intacto', () => {
    const puro = 'G  D\nUma linha de letra'
    const r = extractImportHeader(puro)
    expect(r.title).toBeNull()
    expect(r.artist).toBeNull()
    expect(r.body).toBe(puro)
  })
  it('cabeçalho no meio do texto não é cabeçalho', () => {
    const texto = 'G  D\nLinha\nMúsica: falso\n'
    const r = extractImportHeader(texto)
    expect(r.title).toBeNull()
    expect(r.body).toBe(texto)
  })
})
