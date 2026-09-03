import { describe, expect, test } from 'bun:test'
import { idsTravados, quantoFalta, recadoAoSalvar, travadosNoPlano } from './limites.ts'

const item = (id: string, createdAt: number) => ({ id, createdAt })
// nove músicas criadas em ordem, a mais velha primeiro
const nove = Array.from({ length: 9 }, (_, i) => item('m' + (i + 1), 1000 + i))

describe('o que fica travado acima do teto', () => {
  test('cabendo tudo, nada trava', () => {
    expect(idsTravados(nove.slice(0, 8), 8)).toEqual([])
  })

  test('passando do teto, trava só o excedente', () => {
    expect(idsTravados(nove, 8)).toEqual(['m9'])
  })

  test('as mais velhas continuam livres: a trava é sempre nas últimas que entraram', () => {
    const doze = Array.from({ length: 12 }, (_, i) => item('m' + (i + 1), 1000 + i))
    expect(idsTravados(doze, 8)).toEqual(['m9', 'm10', 'm11', 'm12'])
  })

  test('a ordem de chegada manda, não a ordem em que a lista veio', () => {
    const embaralhado = [item('c', 3000), item('a', 1000), item('b', 2000)]
    expect(idsTravados(embaralhado, 2)).toEqual(['c'])
  })

  test('empate na data não faz a trava dançar entre uma abertura e outra', () => {
    const empate = [item('b', 1000), item('a', 1000), item('c', 1000)]
    // com a mesma data, o desempate é pelo id: sempre o mesmo resultado
    expect(idsTravados(empate, 2)).toEqual(['c'])
    expect(idsTravados([...empate].reverse(), 2)).toEqual(['c'])
  })

  test('teto infinito não trava nada', () => {
    expect(idsTravados(nove, Infinity)).toEqual([])
  })
})

describe('travado, por plano', () => {
  test('quem paga não tem nada travado', () => {
    const r = travadosNoPlano('pago', nove, [item('s1', 1), item('s2', 2)])
    expect(r.musicas.size).toBe(0)
    expect(r.shows.size).toBe(0)
  })

  test('no grátis, para quem já foi pagante, a nona e o segundo show travam', () => {
    const r = travadosNoPlano('gratis', nove, [item('s1', 1), item('s2', 2)], true)
    expect([...r.musicas]).toEqual(['m9'])
    expect([...r.shows]).toEqual(['s2'])
  })

  test('rebaixar não apaga: o total continua o mesmo, só muda o que abre', () => {
    const r = travadosNoPlano('gratis', nove, [], true)
    expect(nove.length).toBe(9)
    expect(r.musicas.size).toBe(1)
  })

  test('quem NUNCA pagou não perde o que já tinha; só não pode crescer', () => {
    // biblioteca de antes de existir plano, ou trazida de um backup: trancar
    // aqui seria tirar da pessoa algo que ela nunca foi avisada que ia perder
    const r = travadosNoPlano('gratis', nove, [item('s1', 1), item('s2', 2)], false)
    expect(r.musicas.size).toBe(0)
    expect(r.shows.size).toBe(0)
  })
})

describe('recados de limite', () => {
  test('a oitava música avisa que foi a última do grátis', () => {
    const r = recadoAoSalvar('gratis', 8)
    expect(r).toContain('última')
    expect(r).toContain('8')
  })

  test('antes da oitava e depois dela, esse recado não aparece', () => {
    expect(recadoAoSalvar('gratis', 7)).toBe(null)
    expect(recadoAoSalvar('gratis', 9)).toBe(null)
    expect(recadoAoSalvar('pago', 8)).toBe(null)
  })

  test('quanto falta para o teto, no grátis', () => {
    expect(quantoFalta('gratis', 5)).toBe(3)
    expect(quantoFalta('gratis', 8)).toBe(0)
    expect(quantoFalta('gratis', 20)).toBe(0)
  })

  test('quem paga não tem quanto faltar', () => {
    expect(quantoFalta('pago', 500)).toBe(null)
  })
})
