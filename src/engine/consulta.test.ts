import { describe, expect, test } from 'bun:test'
import { PISO_CONSULTA_MS, precisaConsultar, textoDoAviso } from './consulta.ts'
import type { Licenca } from './licenca.ts'

const AGORA = Date.UTC(2026, 8, 2, 12, 0, 0)
const DIA = 86_400_000
const paga = (validaEmDias: number, conferidaHaDias = 0): Licenca => ({
  plano: 'pago',
  validaAte: AGORA + validaEmDias * DIA,
  conferidaEm: AGORA - conferidaHaDias * DIA,
  renova: true,
})
const gratis = (conferidaHaDias = 0): Licenca => ({
  plano: 'gratis',
  validaAte: 0,
  conferidaEm: AGORA - conferidaHaDias * DIA,
})

const mundo = (extra: Partial<Parameters<typeof precisaConsultar>[0]> = {}) => ({
  licenca: paga(30, 1),
  agora: AGORA,
  online: true,
  noPalco: false,
  ultimaTentativa: AGORA - 60 * 60_000,
  ...extra,
})

describe('quando o app deve perguntar de novo ao servidor', () => {
  test('no palco NUNCA pergunta, nem que a licença esteja vencendo hoje', () => {
    expect(precisaConsultar(mundo({ noPalco: true }))).toBe(false)
    expect(precisaConsultar(mundo({ noPalco: true, licenca: paga(30, 7) }))).toBe(false)
  })

  test('sem internet não adianta perguntar', () => {
    expect(precisaConsultar(mundo({ online: false }))).toBe(false)
  })

  test('duas tentativas coladas viram uma: existe um piso de tempo', () => {
    expect(precisaConsultar(mundo({ ultimaTentativa: AGORA - 5_000 }))).toBe(false)
    expect(precisaConsultar(mundo({ ultimaTentativa: AGORA - PISO_CONSULTA_MS - 1 }))).toBe(true)
  })

  test('quem nunca perguntou pergunta na primeira chance', () => {
    expect(precisaConsultar(mundo({ ultimaTentativa: 0 }))).toBe(true)
  })

  test('resposta fresca do servidor não precisa ser refeita a cada abertura', () => {
    // confirmada há 10 minutos e válida por 30 dias: não há o que perguntar
    const recente = { ...paga(30, 0), conferidaEm: AGORA - 10 * 60_000 }
    expect(precisaConsultar(mundo({ licenca: recente, ultimaTentativa: AGORA - 10 * 60_000 }))).toBe(false)
  })

  test('perto do fim da tolerância pergunta sempre que pode', () => {
    expect(precisaConsultar(mundo({ licenca: paga(30, 6), ultimaTentativa: AGORA - PISO_CONSULTA_MS - 1 }))).toBe(true)
  })

  test('quem está no grátis também confere, para a compra destravar sozinha', () => {
    expect(precisaConsultar(mundo({ licenca: gratis(1), ultimaTentativa: AGORA - PISO_CONSULTA_MS - 1 }))).toBe(true)
  })

  test('e confere mesmo com a resposta recém-chegada: é assim que a compra entra', () => {
    // quem acabou de pagar não pode esperar meia hora para usar o que comprou
    const agoraMesmo = { ...gratis(), conferidaEm: AGORA - 10_000 }
    expect(precisaConsultar(mundo({ licenca: agoraMesmo, ultimaTentativa: AGORA - PISO_CONSULTA_MS - 1 }))).toBe(true)
  })
})

describe('o aviso de que vai precisar de internet', () => {
  test('longe do fim não avisa nada', () => {
    expect(textoDoAviso(paga(30, 0), AGORA)).toBe(null)
    expect(textoDoAviso(gratis(), AGORA)).toBe(null)
  })

  test('faltando poucos dias, avisa em português de gente', () => {
    const dois = textoDoAviso(paga(30, 5), AGORA)
    expect(dois).toContain('2 dias')
    expect(dois).toContain('internet')
  })

  test('no último dia fala de hoje, não de "0 dias"', () => {
    const zero = textoDoAviso(paga(30, 7), AGORA)
    expect(zero).toContain('hoje')
    expect(zero).not.toContain('0 dias')
  })

  test('um dia é dia, não dias', () => {
    expect(textoDoAviso(paga(30, 6), AGORA)).toContain('1 dia')
    expect(textoDoAviso(paga(30, 6), AGORA)).not.toContain('1 dias')
  })

  test('passado o prazo, o aviso vira o que aconteceu de verdade', () => {
    const fora = textoDoAviso(paga(30, 9), AGORA)
    expect(fora).toContain('grátis')
    expect(fora).toContain('internet')
  })
})
