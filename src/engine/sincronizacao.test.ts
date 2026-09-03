import { describe, expect, test } from 'bun:test'
import {
  bloqueioDaSincronizacao,
  bloqueioDoServidor,
  motivoParaAssinar,
  podeSincronizar,
  textoDoBloqueio,
  voltaSozinho,
} from './sincronizacao.ts'

describe('quem pode usar a nuvem', () => {
  test('conta com plano pago sincroniza', () => {
    expect(podeSincronizar({ temConta: true, plano: 'pago' })).toBe(true)
    expect(bloqueioDaSincronizacao({ temConta: true, plano: 'pago' })).toBe('nenhum')
  })

  test('sem conta, o motivo é a conta, não o dinheiro', () => {
    // dizer "assine" para quem nem entrou ainda é mandar a pessoa pagar por
    // algo que ela não tem como usar: primeiro a conta, depois o plano
    expect(bloqueioDaSincronizacao({ temConta: false, plano: 'gratis' })).toBe('sem-conta')
    expect(bloqueioDaSincronizacao({ temConta: false, plano: 'pago' })).toBe('sem-conta')
  })

  test('com conta e no grátis, o motivo é o plano', () => {
    expect(bloqueioDaSincronizacao({ temConta: true, plano: 'gratis' })).toBe('sem-plano')
    expect(podeSincronizar({ temConta: true, plano: 'gratis' })).toBe(false)
  })
})

describe('a recusa que vem do servidor', () => {
  test('402 é assinatura, 401 e 403 são crachá', () => {
    expect(bloqueioDoServidor(402)).toBe('sem-plano')
    expect(bloqueioDoServidor(401)).toBe('sem-conta')
    expect(bloqueioDoServidor(403)).toBe('sem-conta')
  })

  test('erro de servidor não vira recusa de plano', () => {
    // 502 é servidor fora do ar. Dizer "assine" nessa hora seria mentir para
    // quem já paga, e a pessoa ainda ia tentar comprar de novo
    expect(bloqueioDoServidor(500)).toBe('nenhum')
    expect(bloqueioDoServidor(502)).toBe('nenhum')
    expect(bloqueioDoServidor(409)).toBe('nenhum')
    expect(bloqueioDoServidor(200)).toBe('nenhum')
  })
})

describe('o que a tela diz', () => {
  test('cada bloqueio tem uma frase, e ela não fala em código de erro', () => {
    for (const b of ['sem-conta', 'sem-plano'] as const) {
      const t = textoDoBloqueio(b)
      expect(t).toBeTruthy()
      expect(t).not.toMatch(/40[123]|erro|falhou/i)
    }
  })

  test('quem não pode sincronizar é avisado de que nada foi perdido', () => {
    expect(textoDoBloqueio('sem-plano')).toMatch(/continuam inteiras|backup/i)
  })

  test('sem bloqueio não há recado', () => {
    expect(textoDoBloqueio('nenhum')).toBe(null)
  })

  test('o convite da assinatura fala do benefício, não da trava', () => {
    expect(motivoParaAssinar()).toMatch(/iPad|celular|aparelho/i)
  })
})

describe('voltar a pagar não pede pareamento de novo', () => {
  test('com a chave guardada, voltar a poder basta', () => {
    expect(voltaSozinho(true, true)).toBe(true)
  })

  test('sem a chave não volta sozinho: aí sim é parear de novo', () => {
    expect(voltaSozinho(false, true)).toBe(false)
  })

  test('com a chave mas ainda sem poder, continua parado', () => {
    expect(voltaSozinho(true, false)).toBe(false)
  })
})
