// O que o plano grátis deixa aberto, e o que ele tranca.
//
// A regra que manda em tudo aqui é uma só: REBAIXAR NUNCA APAGA. Quem tinha
// 40 músicas e parou de pagar continua com 40 músicas no aparelho; oito ficam
// abertas e o resto fica trancado, visível e exportável a qualquer momento.
// Nenhuma linha deste arquivo remove nada de lugar nenhum.
//
// A escolha de QUAIS ficam abertas também importa: são sempre as mais antigas.
// Duas razões práticas. A primeira é que o repertório antigo é o que a pessoa
// já usa no palco, e tirar isso dela seria o pior corte possível. A segunda é
// que a conta precisa dar o mesmo resultado toda vez: se a trava pulasse de
// música a cada abertura do app, ninguém confiaria no que está vendo.

import { limitesDoPlano, type Plano } from './licenca.ts'

/** O mínimo que este módulo precisa saber de uma música ou de um show. */
export interface Item {
  id: string
  createdAt: number
}

/**
 * Os ids que passam do teto, do mais novo para o mais velho.
 * Empate de data é desempatado pelo id, para o resultado nunca dançar.
 */
export function idsTravados(itens: Item[], teto: number): string[] {
  if (!Number.isFinite(teto) || itens.length <= teto) return []
  const ordenado = [...itens].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return ordenado.slice(teto).map((i) => i.id)
}

export interface Travados {
  musicas: Set<string>
  shows: Set<string>
}

/**
 * O que fica trancado AGORA.
 *
 * `jaFoiPagante` é o que separa dois mundos que parecem iguais e não são:
 *
 *   - quem nunca pagou não pode PASSAR de 8 músicas, e o app impede isso na
 *     hora de adicionar. Se mesmo assim o aparelho tem mais (uma biblioteca
 *     de antes de existir plano, ou um backup importado), nada é trancado:
 *     seria tirar da pessoa algo que ela nunca foi avisada que ia perder;
 *   - quem pagou e parou vê as excedentes trancadas, visíveis e exportáveis.
 *     Essa pessoa sabia o que estava contratando, e nada foi apagado.
 */
export function travadosNoPlano(plano: Plano, musicas: Item[], shows: Item[], jaFoiPagante = false): Travados {
  const vazio = { musicas: new Set<string>(), shows: new Set<string>() }
  if (plano === 'gratis' && !jaFoiPagante) return vazio
  const teto = limitesDoPlano(plano)
  return {
    musicas: new Set(idsTravados(musicas, teto.musicas)),
    shows: new Set(idsTravados(shows, teto.shows)),
  }
}

/** Aviso na hora de salvar a última que cabe. Null quando não há o que dizer. */
export function recadoAoSalvar(plano: Plano, quantidadeDepois: number): string | null {
  const teto = limitesDoPlano(plano).musicas
  if (!Number.isFinite(teto) || quantidadeDepois !== teto) return null
  return `Essa foi a última das ${teto} músicas do plano grátis. A próxima já pede assinatura, e nada do que está aqui é apagado.`
}

/** Quantas ainda cabem no plano, ou null para quem não tem teto. */
export function quantoFalta(plano: Plano, quantidadeAtual: number): number | null {
  const teto = limitesDoPlano(plano).musicas
  if (!Number.isFinite(teto)) return null
  return Math.max(0, teto - quantidadeAtual)
}
