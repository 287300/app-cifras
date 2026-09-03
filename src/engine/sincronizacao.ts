// Quem pode usar a nuvem, e o que dizer para quem não pode. Sem rede e sem
// tela: só a decisão.
//
// A sincronização é o único recurso do app que custa dinheiro todo mês para
// existir (servidor, banco, banda). Por isso ela é a linha entre o grátis e o
// pago. As músicas, não: essas moram no aparelho e continuam lá de qualquer
// jeito, pagando ou não.
//
// Duas coisas que este módulo garante e que valem mais do que parecem:
//
// 1. Recusa NÃO é desligar. Quem para de pagar mantém a chave do conjunto
//    guardada no aparelho; a sincronização fica parada, não apagada. No dia em
//    que voltar a pagar, volta sozinha, sem parear os aparelhos de novo.
//
// 2. Recusa vira frase, não erro. "nuvem respondeu 402" não é recado para
//    ninguém. Cada recusa tem uma frase que diz o que aconteceu e o que fazer.

import type { Plano } from './licenca.ts'

/** Por que a nuvem está fora de alcance agora. */
export type Bloqueio = 'nenhum' | 'sem-conta' | 'sem-plano'

export interface Situacao {
  temConta: boolean
  plano: Plano
}

export function bloqueioDaSincronizacao(s: Situacao): Bloqueio {
  if (!s.temConta) return 'sem-conta'
  if (s.plano !== 'pago') return 'sem-plano'
  return 'nenhum'
}

export function podeSincronizar(s: Situacao): boolean {
  return bloqueioDaSincronizacao(s) === 'nenhum'
}

/**
 * A recusa do servidor traduzida para o mesmo vocabulário da tela.
 *
 * O aparelho já decide sozinho antes de chamar, então chegar aqui significa
 * que os dois discordam: crachá vencido, assinatura que acabou faz cinco
 * minutos, relógio adiantado. Quem manda é o servidor.
 */
export function bloqueioDoServidor(status: number): Bloqueio {
  if (status === 402) return 'sem-plano'
  if (status === 401 || status === 403) return 'sem-conta'
  return 'nenhum'
}

/** O recado do cartão de sincronização. Null quando não há o que dizer. */
export function textoDoBloqueio(b: Bloqueio): string | null {
  if (b === 'sem-conta') {
    return 'Para sincronizar entre aparelhos é preciso entrar com o seu e-mail aqui em cima. É a conta que diz ao servidor quais cópias são suas.'
  }
  if (b === 'sem-plano') {
    return 'Sincronizar entre aparelhos é recurso da assinatura. Suas músicas continuam inteiras neste aparelho, e o backup em arquivo continua liberado.'
  }
  return null
}

/** O motivo que abre a folha de assinatura, na voz de quem está sendo barrado. */
export function motivoParaAssinar(): string {
  return 'A sincronização mantém as mesmas músicas no iPad e no celular, cada mudança aparecendo no outro sozinha.'
}

/**
 * Um aparelho que ficou parado por falta de plano volta sozinho?
 *
 * Volta, e é isto que separa "parado" de "desligado": enquanto a chave do
 * conjunto continuar guardada, voltar a pagar basta. Sem a chave seria preciso
 * parear os aparelhos de novo, e ninguém deveria pagar duas vezes pelo mesmo
 * trabalho.
 */
export function voltaSozinho(tinhaChave: boolean, agoraPode: boolean): boolean {
  return tinhaChave && agoraPode
}
