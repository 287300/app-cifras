// As regras da conta, sem rede e sem tela.
//
// Aqui mora tudo o que decide "esse e-mail está bom", "esse código está
// completo", "está na hora de renovar em silêncio" e, principalmente, "como
// se diz isso em português para alguém que não é de tecnologia".
//
// Duas regras valem acima das outras:
//   1. Senha não existe. Nem para digitar, nem para guardar, nem para esquecer.
//   2. Nenhum erro do servidor chega na tela em inglês ou com número de código.

/** O que o aparelho guarda depois que a pessoa entra. Nunca tem senha. */
export interface Sessao {
  email: string
  userId: string
  accessToken: string
  refreshToken: string
  /** Quando o crachá de acesso vence, em ms desde a época. */
  expiraEm: number
}

/** Margem antes do vencimento: um pedido leva alguns segundos para ir e voltar. */
const MARGEM_MS = 30_000
/** Renova em silêncio quando falta pouco, para nunca vencer com a pessoa usando. */
const RENOVA_ANTES_MS = 5 * 60_000

/** Para onde vale a pena palpitar quando o domínio tem cara de erro de dedo. */
const ALVOS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'globo.com',
]

// Domínios que EXISTEM e são parecidos com os de cima. Sem esta lista o app
// mandaria trocar mail.com, ymail.com ou email.com por gmail.com, que é
// palpite errado com cara de certeza.
const CONHECIDOS = new Set([
  ...ALVOS,
  'mail.com',
  'email.com',
  'ymail.com',
  'live.com',
  'live.com.br',
  'msn.com',
  'aol.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'zipmail.com.br',
  'ig.com.br',
  'r7.com',
  'oi.com.br',
])

export function normalizaEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * O que está errado no e-mail, em uma frase que a pessoa entende, ou null.
 * A ordem importa: reclama primeiro do que ela consegue ver na hora.
 */
export function problemaNoEmail(raw: string): string | null {
  const email = normalizaEmail(raw)
  if (!email) return 'Digite o seu e-mail.'
  const arrobas = email.split('@').length - 1
  if (arrobas > 1) return 'Esse e-mail tem @ demais.'
  if (arrobas === 0) return 'Falta o @ no e-mail.'
  const [local, dominio] = email.split('@')
  if (!local) return 'Falta o que vem antes do @.'
  if (!dominio) return 'Falta o que vem depois do @, como gmail.com.'
  if (!dominio.includes('.')) return 'Falta o ponto no fim, como .com ou .com.br.'
  if (dominio.startsWith('.') || dominio.endsWith('.')) return 'Confira os pontos depois do @.'
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return 'Confira o e-mail: tem algum caractere que não pode.'
  return null
}

/** Erro de dedo no provedor (gmail.con) vira sugestão, nunca recusa. */
export function sugestaoDeEmail(raw: string): string | null {
  const email = normalizaEmail(raw)
  if (problemaNoEmail(email)) return null
  const corte = email.lastIndexOf('@')
  const local = email.slice(0, corte)
  const dominio = email.slice(corte + 1)
  if (CONHECIDOS.has(dominio)) return null
  if (dominio.length < 5) return null
  for (const bom of ALVOS) {
    // só palpita em TROCA de letra, nunca em letra a mais ou a menos: mail.com
    // e gmail.com estão a uma letra de distância e são os dois de verdade
    if (dominio.length !== bom.length) continue
    if (distancia(dominio, bom) <= 2) return local + '@' + bom
  }
  return null
}

/** Quantas letras precisam mudar para uma palavra virar a outra. */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    for (let j = 1; j <= b.length; j++) {
      const troca = a[i - 1] === b[j - 1] ? 0 : 1
      atual[j] = Math.min(atual[j - 1]! + 1, anterior[j]! + 1, anterior[j - 1]! + troca)
    }
    anterior = atual
  }
  return anterior[b.length]!
}

/** Aceita o código como a pessoa digitar: com espaço, traço ou colado. */
export function normalizaCodigo(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

export function codigoCompleto(codigo: string): boolean {
  return normalizaCodigo(codigo).length === 6
}

/** O crachá ainda serve para falar com o servidor agora? */
export function tokenUtilizavel(sessao: Sessao, agora: number): boolean {
  return agora < sessao.expiraEm - MARGEM_MS
}

/** Está na hora de renovar em silêncio, antes de alguém esbarrar no vencimento? */
export function precisaRenovar(sessao: Sessao, agora: number): boolean {
  return agora >= sessao.expiraEm - RENOVA_ANTES_MS
}

/**
 * Traduz qualquer tropeço do servidor para uma frase que resolve.
 * Nunca devolve texto em inglês nem número de erro.
 */
/** De qual passo veio o tropeço: muda o recado quando o servidor não explica. */
export type PassoDaConta = 'email' | 'codigo' | 'geral'

export function mensagemDoErro(status: number, code: string, message: string, passo: PassoDaConta = 'geral'): string {
  const texto = (message || '').toLowerCase()
  if (status === 0 || /failed to fetch|network|load failed/.test(texto)) {
    return 'Sem internet agora. Conecte e tente de novo.'
  }
  if (status === 429 || code === 'over_email_send_rate_limit') {
    return 'Muitos pedidos seguidos. Espere um minuto e peça o código de novo.'
  }
  if (code === 'otp_expired' || /expired/.test(texto)) {
    return 'Esse código venceu. Peça outro e use em até 1 hora.'
  }
  // o recado do e-mail vem ANTES do de código: a recusa do servidor no passo
  // do e-mail diz "invalid format", e mandar conferir 6 números que ainda nem
  // foram enviados é o pior recado possível
  if (code === 'validation_failed' || code === 'email_address_invalid' || /email/.test(texto)) {
    return 'Esse e-mail não foi aceito. Confira se está escrito certo.'
  }
  // recusa seca (403 de proxy de wi-fi, por exemplo) na tela do e-mail não pode
  // mandar conferir número nenhum: ali ainda não existe código
  if ((status === 401 || status === 403 || code === 'invalid_credentials' || /invalid/.test(texto)) && passo !== 'email') {
    return 'Código errado. Confira os 6 números do e-mail.'
  }
  if (status >= 500) {
    return 'O servidor está fora do ar agora. Tente de novo em alguns minutos.'
  }
  return 'Não deu certo agora. Tente de novo em alguns minutos.'
}
