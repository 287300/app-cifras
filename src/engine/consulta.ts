// Quando vale a pena perguntar ao servidor se a pessoa pagou, e o que dizer
// para ela sobre isso. Sem rede e sem tela: só a decisão.
//
// A regra de palco manda em tudo o que está aqui. No meio do show o app não
// pergunta nada a ninguém: uma resposta que chegasse ali poderia mudar a tela
// entre uma música e outra, e não existe motivo no mundo que justifique isso.
// A pergunta espera a saída do palco, e a resposta guardada continua valendo.

import { diasAteExigirInternet, estadoDaLicenca, TOLERANCIA_DIAS, type Licenca } from './licenca.ts'

/** Tempo mínimo entre duas perguntas, para foco e ronda não virarem enxurrada. */
export const PISO_CONSULTA_MS = 60_000
/** Resposta mais nova que isto não precisa ser refeita ao abrir o app. */
const FRESCA_MS = 30 * 60_000
/** A partir daqui a pergunta vira urgente: aproveita toda chance de internet. */
const URGENTE_DIAS = 2

export interface Mundo {
  licenca: Licenca
  agora: number
  online: boolean
  noPalco: boolean
  /** Quando o app tentou perguntar pela última vez (deu certo ou não). */
  ultimaTentativa: number
}

export function precisaConsultar(m: Mundo): boolean {
  if (m.noPalco) return false // regra de palco: nada de rede no meio do show
  if (!m.online) return false
  if (m.agora - m.ultimaTentativa < PISO_CONSULTA_MS) return false
  // relógio andando para trás (iPad que ficou sem bateria, data trocada na
  // mão): a resposta guardada não é confiável, então pergunta de novo
  if (m.agora < m.licenca.conferidaEm) return true
  // Quem está no grátis pergunta em toda oportunidade (respeitado o piso):
  // é por esta pergunta que a compra chega ao aparelho e destrava o app. Se
  // ela fosse dispensada por "resposta fresca", quem acabou de pagar ficaria
  // esperando meia hora para usar o que comprou.
  if (m.licenca.plano !== 'pago') return true
  // já pagante, com resposta quentinha e longe do prazo: não há o que perguntar
  const faltam = diasAteExigirInternet(m.licenca, m.agora)
  const fresca = m.agora - m.licenca.conferidaEm < FRESCA_MS
  if (fresca && faltam > URGENTE_DIAS) return false
  return true
}

/**
 * O recado sobre precisar de internet, ou null quando não há o que dizer.
 * Aparece cedo e em casa, para nunca ser uma surpresa em cima da hora.
 */
export function textoDoAviso(licenca: Licenca, agora: number): string | null {
  if (licenca.plano !== 'pago') return null
  const estado = estadoDaLicenca(licenca, agora)
  if (estado === 'expirada') {
    // duas causas diferentes, e a pessoa precisa saber qual foi: prazo que
    // acabou não se resolve com wi-fi, e falta de internet não se resolve
    // pagando de novo. Ficar em silêncio é o pior dos dois mundos
    if (agora > licenca.validaAte) {
      return 'Sua assinatura chegou ao fim, então o app voltou para os limites do grátis. Nada foi apagado: nenhuma música, nenhum show.'
    }
    const dias = Math.max(TOLERANCIA_DIAS, Math.floor((agora - licenca.conferidaEm) / 86_400_000))
    return `Faz ${dias} dias sem conferir a assinatura, então o app voltou para os limites do grátis. Nada foi apagado: conecte na internet uma vez e tudo destrava.`
  }
  const faltam = diasAteExigirInternet(licenca, agora)
  if (faltam > URGENTE_DIAS) return null
  if (faltam <= 0) return 'O app precisa de internet hoje para conferir a sua assinatura. Resolva em casa, não no palco.'
  return `O app precisa de internet em ${faltam} ${faltam === 1 ? 'dia' : 'dias'} para conferir a sua assinatura. Melhor fazer isso em casa do que descobrir no palco.`
}
