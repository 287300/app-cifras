// O app pergunta ao servidor se a pessoa paga, e guarda a resposta.
//
// A resposta guardada é o que vale quando não há internet. É ela que permite
// tocar um show inteiro em modo avião sem o app duvidar de quem paga, e é ela
// que expira sozinha depois de 7 dias sem conferir.
//
// Três regras mandam aqui, nesta ordem:
//
//   1. NO PALCO NADA ACONTECE. Enquanto a rota for #/play o app não pergunta
//      nem muda de estado. Uma resposta chegando no meio do show poderia
//      trocar a tela entre duas músicas, e não existe motivo que justifique
//      isso. A pergunta fica esperando a saída do palco.
//   2. Sem conta, o plano é o grátis. Sair da conta não apaga música nenhuma,
//      só tira o que a assinatura destravava.
//   3. Rebaixar nunca apaga: quem decide o que fazer com o limite é a tela,
//      e o que ela faz é travar, nunca sumir.

import { contaAtual, onContaChange, tokenDeAcesso } from './conta.ts'
import { db } from './db.ts'
import { precisaConsultar, textoDoAviso } from './engine/consulta.ts'
import { planoEfetivo, type Licenca, type Plano } from './engine/licenca.ts'
import { FUNCOES, SUPABASE_ANON } from './supabase.ts'

const FN = FUNCOES + '/licenca'
const CHAVE = 'licenca'
/** De quanto em quanto tempo o app aberto reconfere sozinho. */
const RONDA_MS = Number(new URLSearchParams(location.search).get('rondaLic')) || 6 * 60 * 60_000

const SEM_CONTA: Licenca = { plano: 'gratis', validaAte: 0, conferidaEm: 0 }
/** Prazo para o servidor responder. Wi-fi de casa de show aceita e não responde. */
const PRAZO_MS = 8000

interface Guardada extends Licenca {
  /**
   * De quem é esta resposta. É o userId, não o e-mail: o e-mail pode voltar
   * vazio do servidor, e duas pessoas com e-mail vazio virariam a mesma
   * pessoa, herdando uma a assinatura da outra.
   */
  userId: string
  /**
   * Esta conta já pagou alguma vez neste aparelho. É o que separa "nunca
   * pagou e tem uma biblioteca antiga" de "pagou e parou": só a segunda vê
   * as excedentes trancadas. Nas duas, nada é apagado.
   */
  jaFoiPagante?: boolean
}

let licenca: Licenca = SEM_CONTA
let dono = '' // userId de quem esta licença pertence
/**
 * A linha que estava no banco do aparelho, guardada mesmo quando ainda não deu
 * para adotar.
 *
 * Existe por causa de uma corrida real: quem entra pelo LINK do e-mail tem a
 * conta confirmada por fora do arranque, então esta função roda antes de a
 * conta existir e não adota nada. Sem esta lembrança, a chegada da conta caía
 * em "userId diferente de dono" (que ainda era vazio), o app concluía que era
 * OUTRA pessoa e gravava plano grátis por cima da licença paga. Em modo avião
 * isso não tinha volta: quem pagou via a biblioteca travar em 8 músicas.
 */
let guardadaNoDisco: Guardada | null = null
let foiPagante = false
let ultimaTentativa = 0
let pendente = false // saiu do palco: perguntar assim que der
let ronda: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function onLicencaChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function noPalco(): boolean {
  return location.hash.startsWith('#/play')
}

/** O plano que vale AGORA para efeito de limites. */
export function planoAtual(): Plano {
  return planoEfetivo(licenca, Date.now())
}

export function licencaAtual(): Licenca {
  return licenca
}

/**
 * Os limites do plano valem agora?
 *
 * Só a partir da conta. Sem conta o app não sabe quem é a pessoa, não tem como
 * ela comprar nada e não tem como dar suporte a ela: cobrar teto aí seria
 * cobrar de um desconhecido. Além disso, é o que a especificação pede em
 * "usar o app antes de criar conta, para experimentar sem barreira", e é o que
 * impede que uma biblioteca montada antes de existir plano seja punida.
 *
 * Com conta, os limites valem inteiros: é também o momento em que existe
 * sincronização, compra e suporte.
 */
export function limitesValem(): boolean {
  return contaAtual() !== null
}

/** Esta conta já foi pagante neste aparelho? Decide o que trava ao rebaixar. */
export function jaFoiPagante(): boolean {
  return foiPagante
}

/** O recado sobre precisar de internet, ou null quando não há o que dizer. */
export function avisoDaLicenca(): string | null {
  return textoDoAviso(licenca, Date.now())
}

/** Passa a valer a licença que estava no banco do aparelho. Não toca em rede. */
function adota(linha: Guardada): void {
  licenca = { plano: linha.plano, validaAte: linha.validaAte, conferidaEm: linha.conferidaEm, renova: linha.renova }
  dono = linha.userId
  foiPagante = linha.jaFoiPagante === true || linha.plano === 'pago'
}

async function guarda(nova: Licenca, userId: string): Promise<void> {
  const antes = licenca
  licenca = nova
  dono = userId
  // uma vez pagante, sempre pagante para efeito de trava: é o que autoriza o
  // app a trancar o excedente sem tirar de ninguém algo que nunca foi avisado
  if (nova.plano === 'pago') foiPagante = true
  try {
    const linha: Guardada = { ...nova, userId, jaFoiPagante: foiPagante }
    guardadaNoDisco = linha
    await db.putKv(CHAVE, linha)
  } catch {
    // sem banco: vale para esta sessão e pronto
  }
  const mudou =
    antes.plano !== nova.plano || antes.validaAte !== nova.validaAte || antes.conferidaEm !== nova.conferidaEm
  if (mudou) notify()
}

/**
 * Pergunta ao servidor. `forcar` pula a régua de "vale a pena perguntar",
 * mas NUNCA pula a regra de palco: nem forçando o app mexe no meio do show.
 */
export async function consultaAgora(forcar = false): Promise<void> {
  if (noPalco()) {
    pendente = true
    return
  }
  const conta = contaAtual()
  if (!conta) {
    if (licenca.plano !== 'gratis' || licenca.conferidaEm !== 0) await guarda(SEM_CONTA, '')
    return
  }
  const agora = Date.now()
  if (!forcar && !precisaConsultar({ licenca, agora, online: navigator.onLine, noPalco: false, ultimaTentativa })) {
    return
  }
  if (!navigator.onLine) return
  ultimaTentativa = agora
  // de quem é esta pergunta, decidido ANTES de qualquer espera: a resposta
  // pode demorar minutos num wi-fi ruim, e nesse tempo a pessoa pode sair da
  // conta ou entrar com outra. Resposta de A jamais vira licença de B
  const perguntou = conta.userId
  const token = await tokenDeAcesso()
  if (!token) return // sem crachá utilizável agora: fica valendo o que está guardado
  try {
    const corta = new AbortController()
    const prazo = setTimeout(() => corta.abort(), PRAZO_MS)
    let res: Response
    try {
      res = await fetch(FN, {
        method: 'POST',
        // apikey abre a porta (chave pública); o crachá diz QUEM está entrando
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token },
        body: JSON.stringify({ op: 'consultar' }),
        signal: corta.signal,
      })
    } finally {
      clearTimeout(prazo)
    }
    if (!res.ok) return // 401, servidor fora, portal de wi-fi: mantém o que já valia
    const data = (await res.json()) as { plano?: string; restamMs?: number; renova?: boolean }
    if (contaAtual()?.userId !== perguntou) return // trocou de conta na espera
    if (noPalco()) {
      // o show começou enquanto a resposta vinha: nada muda agora
      pendente = true
      return
    }
    const restam = typeof data.restamMs === 'number' ? Math.max(0, data.restamMs) : 0
    const quando = Date.now()
    // o servidor manda TEMPO QUE FALTA, e a data nasce do relógio deste
    // aparelho: um iPad com a data errada não vira uma licença errada
    await guarda(
      {
        plano: data.plano === 'pago' ? 'pago' : 'gratis',
        validaAte: data.plano === 'pago' ? quando + restam : 0,
        conferidaEm: quando,
        renova: data.renova !== false,
      },
      perguntou
    )
  } catch {
    // sem internet de verdade: a resposta guardada continua valendo
  }
}

function aoVoltarParaFrente(): void {
  if (document.visibilityState !== 'visible') return
  void consultaAgora()
}

function ligaRonda(): void {
  if (ronda) return
  ronda = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    void consultaAgora()
  }, RONDA_MS)
}

/** Uma vez no boot, depois do store e da conta. Nunca joga erro. */
export async function initLicenca(): Promise<void> {
  try {
    const linha = (await db.getKv(CHAVE))?.value as Guardada | undefined
    if (linha?.userId) guardadaNoDisco = linha
    const conta = contaAtual()
    // resposta de outra conta não vale para esta pessoa
    if (linha && conta && linha.userId && linha.userId === conta.userId) {
      adota(linha)
      // a tela já pode estar desenhada com o estado inicial: sem este aviso,
      // quem abre o app em modo avião vê "grátis" mesmo pagando
      notify()
    }
  } catch {
    // sem banco: começa no grátis e a primeira consulta resolve
  }

  onContaChange(() => {
    // no palco nem isto acontece: uma renovação de crachá recusada no meio do
    // show não pode rebaixar o plano entre uma música e outra
    if (noPalco()) {
      pendente = true
      return
    }
    const conta = contaAtual()
    if (!conta) {
      foiPagante = false
      void guarda(SEM_CONTA, '')
      return
    }
    if (conta.userId !== dono) {
      if (guardadaNoDisco && guardadaNoDisco.userId === conta.userId) {
        // é a MESMA pessoa: a licença dela só não tinha sido adotada porque a
        // conta chegou depois do arranque (caminho do link). Adotar, não apagar
        adota(guardadaNoDisco)
        notify()
      } else {
        // conta nova neste aparelho: a licença da anterior não vale mais, e o
        // histórico de pagamento dela também não
        foiPagante = false
        void guarda(SEM_CONTA, conta.userId)
      }
    }
    void consultaAgora(true)
  })

  document.addEventListener('visibilitychange', aoVoltarParaFrente)
  window.addEventListener('online', () => void consultaAgora())
  window.addEventListener('hashchange', () => {
    // saiu do palco: a pergunta que ficou esperando pode acontecer agora
    if (pendente && !noPalco()) {
      pendente = false
      // pergunta adiada pela regra de palco é dívida: zera só o piso de tempo,
      // para o show não engolir a chance do dia, mas mantém o resto da régua
      // (entrar e sair do palco dez vezes não vira dez pedidos)
      ultimaTentativa = 0
      void consultaAgora()
    }
  })
  ligaRonda()
  void consultaAgora()
}
