import { describe, expect, test } from 'bun:test'
import { hojeLocal, idsDeShowsTravados, idsTravados, quantoFalta, recadoAoSalvar, showsPorRelevancia, travadosNoPlano } from './limites.ts'

const item = (id: string, createdAt: number) => ({ id, createdAt })
const show = (id: string, date: string, createdAt = 1000) => ({ id, date, createdAt })
const HOJE = '2026-09-09'
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

describe('shows: o que importa é o show que vem aí, não o mais antigo', () => {
  // O DEFEITO QUE ISTO IMPEDE (achado Spec 8 da revisao de 04/09): com teto de
  // 1 show, o app deixava aberto o show MAIS ANTIGO ja criado e trancava o de
  // hoje, com cadeado e sem caminho para o palco. O musico chegava no show e
  // nao conseguia abrir o show.
  const antigo = show('velho', '2024-03-01', 1)
  const hoje = show('hoje', HOJE, 2)
  const proximo = show('proximo', '2026-09-20', 3)
  const passado = show('mes-passado', '2026-08-15', 4)

  test('o show de hoje ganha de todos', () => {
    expect(idsDeShowsTravados([antigo, hoje, proximo, passado], 1, HOJE)).not.toContain('hoje')
    expect(showsPorRelevancia([antigo, passado, proximo, hoje], HOJE)[0].id).toBe('hoje')
  })

  test('sem show hoje, o proximo que vem manda', () => {
    expect(showsPorRelevancia([antigo, passado, proximo], HOJE)[0].id).toBe('proximo')
  })

  test('so passado: o mais recente fica aberto, nao o mais antigo', () => {
    expect(idsDeShowsTravados([antigo, passado], 1, HOJE)).toEqual(['velho'])
  })

  test('show sem data vai para o fim, mas o mais novo primeiro entre eles', () => {
    const semData = [show('a', '', 10), show('b', '', 20)]
    expect(showsPorRelevancia([...semData, passado], HOJE).map((s) => s.id)).toEqual(['mes-passado', 'b', 'a'])
  })

  test('empate de data nao faz a trava dancar entre uma abertura e outra', () => {
    const a = show('zz', '2026-10-01', 1)
    const b = show('aa', '2026-10-01', 2)
    expect(idsDeShowsTravados([a, b], 1, HOJE)).toEqual(['zz'])
    expect(idsDeShowsTravados([b, a], 1, HOJE)).toEqual(['zz'])
  })

  test('cabendo tudo, nada trava', () => {
    expect(idsDeShowsTravados([antigo, hoje], 5, HOJE)).toEqual([])
    expect(idsDeShowsTravados([antigo, hoje], Infinity, HOJE)).toEqual([])
  })

  test('hojeLocal usa o fuso do aparelho, nunca UTC', () => {
    // 23h de 9 de setembro no horario de Brasilia ja seria dia 10 em UTC
    expect(hojeLocal(new Date(2026, 8, 9, 23, 30))).toBe('2026-09-09')
  })
})

describe('travado, por plano', () => {
  test('quem paga não tem nada travado', () => {
    const r = travadosNoPlano('pago', nove, [show('s1', '2026-01-10'), show('s2', '2026-12-20')], false, HOJE)
    expect(r.musicas.size).toBe(0)
    expect(r.shows.size).toBe(0)
  })

  test('no grátis, para quem já foi pagante, a nona e o segundo show travam', () => {
    // s1 ja passou, s2 e o proximo: quem fica aberto e o s2
    const r = travadosNoPlano('gratis', nove, [show('s1', '2026-01-10'), show('s2', '2026-12-20')], true, HOJE)
    expect([...r.musicas]).toEqual(['m9'])
    expect([...r.shows]).toEqual(['s1'])
  })

  test('rebaixar não apaga: o total continua o mesmo, só muda o que abre', () => {
    const r = travadosNoPlano('gratis', nove, [], true)
    expect(nove.length).toBe(9)
    expect(r.musicas.size).toBe(1)
  })

  test('quem NUNCA pagou não perde o que já tinha; só não pode crescer', () => {
    // biblioteca de antes de existir plano, ou trazida de um backup: trancar
    // aqui seria tirar da pessoa algo que ela nunca foi avisada que ia perder
    const r = travadosNoPlano('gratis', nove, [show('s1', '2026-01-10'), show('s2', '2026-12-20')], false, HOJE)
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
