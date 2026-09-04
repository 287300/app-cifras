// O que o aviso da plataforma de recebimento precisa ter para ser aceito.
//
// Igual ao resto de engine/: sem rede, sem tela, sem banco. Só a decisão de
// "isto é um aviso válido?" e "já vi este aviso antes?", em funções puras que
// dão para testar sem servidor nenhum.
//
// A porta do webhook é a ÚNICA porta pública do projeto: ela responde sem
// crachá, porque quem bate nela é a plataforma e não o app. Então tudo o que
// separa um aviso de verdade de um aviso inventado está aqui e na conferência
// da assinatura, que fica na função de borda porque precisa de criptografia.
//
// ATENÇÃO: o bloco entre as marcas `regras-do-aviso` é copiado, letra por
// letra, dentro de supabase/functions/pagamento/index.ts, porque função de
// borda do Supabase é um arquivo só e não importa nada daqui. O teste
// cobranca.test.ts compara os dois e quebra se alguém mexer em um e esquecer
// o outro.

import type { EventoPagamento } from './licenca.ts'

// <<< regras-do-aviso

/** Um aviso já conferido e traduzido para o vocabulário do app. */
export interface AvisoDePagamento {
  evento: EventoPagamento
  produto: string
  email: string
  externoId: string
  ocorridoEm: number
}

/** Os cinco eventos que a régua da licença sabe aplicar. Nada além disso entra. */
export const EVENTOS_ACEITOS: readonly EventoPagamento[] = [
  'compra',
  'renovacao',
  'atraso',
  'cancelamento',
  'reembolso',
]

/**
 * Quanto o carimbo de hora do aviso pode estar longe do relógio do servidor.
 *
 * Serve contra repetição: sem janela, um aviso legítimo capturado hoje valeria
 * para sempre, e bastaria reenviá-lo todo mês para ganhar assinatura de graça.
 * Cinco minutos cobrem relógio torto e fila de reentrega sem abrir essa porta.
 */
export const JANELA_MS = 5 * 60_000

/**
 * O aviso está dentro da janela? Vale para os dois lados: carimbo velho é
 * repetição, carimbo no futuro é relógio adulterado.
 */
export function carimboVale(carimboSegundos: number, agora: number): boolean {
  if (!Number.isFinite(carimboSegundos)) return false
  return Math.abs(agora - carimboSegundos * 1000) <= JANELA_MS
}

/**
 * Lê o corpo do aviso. Devolve o aviso pronto ou o motivo da recusa.
 *
 * O e-mail vira minúsculo aqui, e não depois: é ele que liga a compra à
 * pessoa, e "Eder@" e "eder@" precisam ser a mesma linha da tabela.
 */
export function leAviso(corpo: unknown, produtoEsperado: string): { aviso: AvisoDePagamento } | { erro: string } {
  if (typeof corpo !== 'object' || corpo === null) return { erro: 'corpo não é um objeto' }
  const c = corpo as Record<string, unknown>

  const evento = typeof c.evento === 'string' ? c.evento : ''
  if (!(EVENTOS_ACEITOS as readonly string[]).includes(evento)) return { erro: 'evento desconhecido' }

  const produto = typeof c.produto === 'string' ? c.produto.trim() : ''
  if (produto !== produtoEsperado) return { erro: 'aviso de outro produto' }

  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : ''
  // conferência de e-mail deliberadamente frouxa: quem valida de verdade é o
  // servidor de contas na hora de entrar. Aqui só barra o que é claramente lixo
  if (!email || !email.includes('@') || email.length > 320) return { erro: 'e-mail ausente ou inválido' }

  const externoId = typeof c.externoId === 'string' ? c.externoId.trim() : ''
  if (!externoId || externoId.length > 120) return { erro: 'externoId ausente ou grande demais' }

  const ocorridoEm = typeof c.ocorridoEm === 'string' ? Date.parse(c.ocorridoEm) : NaN
  if (!Number.isFinite(ocorridoEm)) return { erro: 'ocorridoEm ausente ou fora do formato' }

  return { aviso: { evento: evento as EventoPagamento, produto, email, externoId, ocorridoEm } }
}

/**
 * O que identifica um aviso para efeito de repetição.
 *
 * A plataforma entrega PELO MENOS UMA VEZ: se a resposta se perder no caminho,
 * ela manda de novo o mesmo aviso. Sem esta chave, uma reentrega viraria um mês
 * de assinatura de brinde. Entra o evento junto do id porque a mesma cobrança
 * pode gerar compra hoje e reembolso amanhã.
 */
export function chaveDoAviso(aviso: AvisoDePagamento): string {
  return aviso.externoId + ':' + aviso.evento
}

/**
 * Compara duas assinaturas em tempo constante.
 *
 * Com `===`, o navegador para no primeiro caractere diferente, e o tempo de
 * resposta entrega, byte a byte, qual era a assinatura certa. São milhares de
 * tentativas, mas é um ataque conhecido e a defesa custa três linhas.
 */
export function mesmaAssinatura(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

// >>> regras-do-aviso
