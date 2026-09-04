// A régua do plano e da licença, sem rede e sem tela.
//
// Tudo o que decide "pode ou não pode" mora aqui, em funções puras, para
// poder ser testado sem navegador e sem servidor. Quem conversa com a nuvem
// é outra camada; ela só traz os fatos e pergunta a estas funções.
//
// Duas regras de palco valem acima de qualquer outra e ficam escritas aqui
// para ninguém esquecer:
//   1. Rebaixar NUNCA apaga música. Acima do limite, trava; não some.
//   2. Nada muda de estado com o modo palco aberto (quem cuida disso é a
//      camada de cima, mas a decisão nasce destas contas).

export type Plano = 'gratis' | 'pago'

/** O que o aparelho sabe sobre a licença, guardado localmente. */
export interface Licenca {
  plano: Plano
  /** Fim do período pago, em ms desde a época. Zero no plano grátis. */
  validaAte: number
  /** Quando o servidor confirmou isso pela última vez, em ms. */
  conferidaEm: number
  /** Falso depois de um cancelamento: vale até o fim, mas não renova. */
  renova?: boolean
}

export interface Limites {
  musicas: number
  shows: number
}

/** O que o servidor manda quando a plataforma de pagamento avisa algo. */
export type EventoPagamento = 'compra' | 'renovacao' | 'atraso' | 'cancelamento' | 'reembolso'

const DIA = 86_400_000
/** Quanto tempo o app confia na última resposta do servidor. */
export const TOLERANCIA_DIAS = 7
/** Fôlego para cartão recusado antes de cortar o acesso. */
export const CARENCIA_DIAS = 5
/** Duração de um período pago. */
export const PERIODO_DIAS = 31
/** A partir daqui o app já avisa que vai precisar de internet. */
export const AVISO_DIAS = 2

export const LIMITE_GRATIS: Limites = { musicas: 8, shows: 1 }
const SEM_LIMITE: Limites = { musicas: Infinity, shows: Infinity }

export function limitesDoPlano(plano: Plano): Limites {
  return plano === 'pago' ? SEM_LIMITE : LIMITE_GRATIS
}

export function podeGuardarMusica(plano: Plano, quantidadeAtual: number): boolean {
  return quantidadeAtual < limitesDoPlano(plano).musicas
}

export function podeCriarShow(plano: Plano, quantidadeAtual: number): boolean {
  return quantidadeAtual < limitesDoPlano(plano).shows
}

/** Quantas músicas passam do teto (as que ficam travadas, nunca apagadas). */
export function quantasAcimaDoLimite(plano: Plano, quantidadeAtual: number): number {
  const teto = limitesDoPlano(plano).musicas
  return Number.isFinite(teto) ? Math.max(0, quantidadeAtual - teto) : 0
}

export type EstadoLicenca =
  | 'gratis' // sem assinatura: vale, com limites
  | 'ativa' // paga e confirmada há pouco
  | 'tolerancia' // ainda funciona, mas já precisa de internet em breve
  | 'expirada' // acabou: volta aos limites do grátis, sem apagar nada

/**
 * Duas contas independentes, e as duas precisam passar:
 *
 *   1. o prazo pago ainda não acabou (validaAte);
 *   2. o servidor confirmou isso nos últimos 7 dias (conferidaEm).
 *
 * A segunda é a tolerância offline, e ela conta A PARTIR DA CONFIRMAÇÃO, não
 * do vencimento: é o que permite tocar um fim de semana inteiro sem sinal e,
 * ao mesmo tempo, impede que um aparelho fique pago para sempre só por nunca
 * mais abrir a internet. Perto do fim dessa janela o estado vira 'tolerancia',
 * que é o gancho para avisar em casa em vez de no palco.
 */
export function estadoDaLicenca(licenca: Licenca, agora: number): EstadoLicenca {
  if (licenca.plano !== 'pago') return 'gratis'
  if (agora > licenca.validaAte) return 'expirada'
  const faltam = diasAteExigirInternet(licenca, agora)
  if (faltam < 0) return 'expirada'
  return faltam <= AVISO_DIAS ? 'tolerancia' : 'ativa'
}

/** O plano que vale AGORA para efeito de limites. */
export function planoEfetivo(licenca: Licenca, agora: number): Plano {
  const estado = estadoDaLicenca(licenca, agora)
  return estado === 'ativa' || estado === 'tolerancia' ? 'pago' : 'gratis'
}

/** Dias que faltam para o app exigir internet. Negativo quando já exigiu. */
export function diasAteExigirInternet(licenca: Licenca, agora: number): number {
  if (licenca.plano !== 'pago') return Infinity
  const faltam = Math.floor((licenca.conferidaEm + TOLERANCIA_DIAS * DIA - agora) / DIA)
  // teto: com o relógio do aparelho recuado, esta conta cresceria sem limite e
  // a licença nunca mais precisaria de internet
  return Math.min(TOLERANCIA_DIAS, faltam)
}

// <<< regra-da-cobranca
/**
 * Tabela de decisão da cobrança. É esta função que a função de borda usa ao
 * receber o webhook, seja qual for a plataforma: o tradutor de cada uma só
 * precisa entregar um EventoPagamento.
 *
 * ATENÇÃO: copiada letra por letra dentro de supabase/functions/pagamento/,
 * porque função de borda é um arquivo só. O teste cobranca.test.ts compara as
 * duas cópias e quebra se alguém mexer em uma e esquecer a outra.
 */
export function aplicarEventoDePagamento(atual: Licenca, evento: EventoPagamento, agora: number): Licenca {
  const periodo = PERIODO_DIAS * DIA
  switch (evento) {
    case 'compra':
      return { plano: 'pago', validaAte: agora + periodo, conferidaEm: agora, renova: true }
    case 'renovacao':
      // renovação atrasada não pode encurtar o período de quem estava em dia
      return { plano: 'pago', validaAte: Math.max(agora, atual.validaAte) + periodo, conferidaEm: agora, renova: true }
    case 'atraso':
      // cartão recusado: mantém de pé pela carência, sem estender quem já tem prazo maior
      return {
        plano: 'pago',
        validaAte: Math.max(atual.validaAte, agora + CARENCIA_DIAS * DIA),
        conferidaEm: agora,
        renova: atual.renova ?? true,
      }
    case 'cancelamento':
      // já pagou o mês: usa até o fim, e só não renova
      return { plano: 'pago', validaAte: atual.validaAte, conferidaEm: agora, renova: false }
    case 'reembolso':
      // devolveu o dinheiro: acesso pago acaba na hora (as músicas ficam)
      return { plano: 'gratis', validaAte: 0, conferidaEm: agora, renova: false }
  }
}
// >>> regra-da-cobranca
