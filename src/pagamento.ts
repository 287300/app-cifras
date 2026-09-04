// O app pedindo a cobrança, e esperando ela cair.
//
// Duas coisas só: pedir o código Pix, e ficar de olho até a licença virar paga.
// Quem decide o que o pagamento faz com a licença é o servidor; aqui não há
// régua nenhuma, de propósito. Se este arquivo pudesse liberar assinatura, um
// navegador com o console aberto também poderia.

import { tokenDeAcesso } from './conta.ts'
import { consultaAgora, onLicencaChange, planoAtual } from './licenca.ts'
import { FUNCOES, SUPABASE_ANON } from './supabase.ts'

const FN = FUNCOES + '/pagamento'
/** Wi-fi de casa de show aceita a conexão e não responde: corta antes do músico desistir. */
const PRAZO_MS = 12_000

export interface Cobranca {
  id: string
  copiaECola: string
  qrPngBase64: string
  expiraEm: string
  valorCentavos: number
  email: string
}

export class ErroDePagamento extends Error {}

/**
 * Pede uma cobrança. O e-mail sai do crachá lá no servidor, não daqui: é o que
 * impede alguém de emitir cobrança em nome de outra pessoa.
 */
export async function pedeCobranca(): Promise<Cobranca> {
  const token = await tokenDeAcesso()
  if (!token) throw new ErroDePagamento('Entre com o seu e-mail antes de assinar.')

  const corta = new AbortController()
  const prazo = setTimeout(() => corta.abort(), PRAZO_MS)
  let res: Response
  try {
    res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token },
      body: JSON.stringify({ op: 'cobrar' }),
      signal: corta.signal,
    })
  } catch {
    throw new ErroDePagamento('Não deu para falar com o servidor. Confira a internet e tente de novo.')
  } finally {
    clearTimeout(prazo)
  }

  const dados = (await res.json().catch(() => ({}))) as Partial<Cobranca> & { error?: string }
  if (!res.ok) throw new ErroDePagamento(dados.error || 'Não deu para gerar a cobrança agora.')
  if (!dados.copiaECola) throw new ErroDePagamento('O servidor respondeu sem o código Pix.')
  return {
    id: dados.id ?? '',
    copiaECola: dados.copiaECola,
    qrPngBase64: dados.qrPngBase64 ?? '',
    expiraEm: dados.expiraEm ?? '',
    valorCentavos: dados.valorCentavos ?? 2990,
    email: dados.email ?? '',
  }
}

/**
 * Fica perguntando ao servidor até a licença virar paga, e avisa quando virar.
 *
 * Aqui existe um relógio, e ele contraria a regra geral do app de não inventar
 * timer: a ronda da licença bate de 6 em 6 horas, o que é certo para o dia a
 * dia e inútil para alguém parado na frente do QR. Este relógio só existe
 * ENQUANTO A TELA DE ESPERA ESTÁ ABERTA, e o `para()` devolvido desliga tudo:
 * sair da tela, pagar, ou o código expirar encerram a pergunta.
 */
export function esperaOPagamento(
  aoLiberar: () => void,
  enquanto: () => boolean = () => true,
  limiteMs = 16 * 60_000
): () => void {
  if (planoAtual() === 'pago') {
    aoLiberar()
    return () => {}
  }
  let vivo = true
  const solta = onLicencaChange(() => {
    if (vivo && planoAtual() === 'pago') {
      para()
      aoLiberar()
    }
  })
  const relogio = setInterval(() => {
    // a tela saiu do ar (trocou de rota, fechou): não há mais o que esperar
    if (!enquanto()) {
      para()
      return
    }
    // fora da frente não adianta perguntar: o navegador segura o pedido e o
    // que volta é uma fila de respostas velhas quando a tela reaparece
    if (document.visibilityState === 'visible') void consultaAgora(true)
  }, 4000)
  const fim = setTimeout(() => para(), limiteMs)

  function para(): void {
    if (!vivo) return
    vivo = false
    clearInterval(relogio)
    clearTimeout(fim)
    solta()
  }
  return para
}

/** Copia para a área de transferência. Devolve false quando o navegador não deixa. */
export async function copia(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
