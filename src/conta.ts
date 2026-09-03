// A conta da pessoa: entrar pelo e-mail, sem senha nenhuma.
//
// Como funciona, na ordem em que a pessoa vive:
//   1. digita o e-mail  → o servidor manda um e-mail com 6 números e um link;
//   2. digita os 6 números (ou toca no link) → o aparelho recebe um crachá;
//   3. o crachá fica guardado no aparelho e se renova sozinho, em silêncio.
//
// Por que os 6 números e não só o link: no iPad e no iPhone, o app instalado
// na tela de início é uma "caixa" separada do Safari. O link abre no Safari e
// deixaria o ícone da tela de início de fora. O código funciona nos dois.
//
// Regras que valem sempre:
//   - senha não existe: não é pedida, não trafega, não é guardada;
//   - sem internet, quem já entrou continua entrando (o crachá vale offline);
//   - só o servidor recusando o crachá desloga alguém, nunca falta de sinal;
//   - crachá que chega pendurado num link só entra depois de o servidor
//     confirmar de quem ele é (link de estranho não troca a conta de ninguém).

import { db } from './db.ts'
import { SUPABASE_ANON, SUPABASE_URL } from './supabase.ts'
import {
  codigoCompleto,
  mensagemDoErro,
  normalizaCodigo,
  normalizaEmail,
  precisaRenovar,
  problemaNoEmail,
  tokenUtilizavel,
  type PassoDaConta,
  type Sessao,
} from './engine/conta.ts'

const AUTH = SUPABASE_URL + '/auth/v1'
/** Prazo para o servidor responder. Wi-fi de casa de show aceita e não responde. */
const PRAZO_MS = 8000

export interface Conta {
  email: string
  userId: string
}

let sessao: Sessao | null = null
// Muda a cada troca de identidade (entrar, sair, renovar). Uma renovação que
// já estava no ar quando a pessoa saiu não pode gravar nada por cima.
let geracao = 0
let renovando: Promise<Sessao | null> | null = null
// A conta que estava aqui antes de um link de OUTRA pessoa trocar a sessão.
// Existe para "Cancelar" significar mesmo voltar ao que era, e não deslogar.
// Vale só para a troca que acabou de acontecer: guardamos a geração junto, e
// qualquer entrada ou saída no meio do caminho aposenta essa volta.
let anterior: Sessao | null = null
let anteriorGeracao = -1
let avisoDoLink = ''
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function onContaChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Recado pendente do caminho do link (vencido, sem internet, recusado). */
export function recadoDoLink(): string {
  return avisoDoLink
}

/** Erro que carrega o código de situação, para separar "sem internet" de "recusado". */
export class ErroDaNuvem extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

interface RespostaAuth {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  user?: { id?: string; email?: string }
  code?: string
  error_code?: string
  msg?: string
  message?: string
  error_description?: string
}

/** fetch que desiste sozinho, para nenhuma tela ficar pendurada esperando. */
async function comPrazo(url: string, init: RequestInit): Promise<Response> {
  const corta = new AbortController()
  const t = setTimeout(() => corta.abort(), PRAZO_MS)
  try {
    return await fetch(url, { ...init, signal: corta.signal })
  } finally {
    clearTimeout(t)
  }
}

async function post(caminho: string, corpo: unknown, passo: PassoDaConta, token?: string): Promise<RespostaAuth> {
  let res: Response
  try {
    res = await comPrazo(AUTH + caminho, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + (token || SUPABASE_ANON),
      },
      body: JSON.stringify(corpo),
    })
  } catch {
    throw new ErroDaNuvem(0, mensagemDoErro(0, '', 'Failed to fetch', passo))
  }
  let data: RespostaAuth = {}
  try {
    const texto = await res.text()
    if (texto) data = JSON.parse(texto) as RespostaAuth
  } catch {
    data = {}
  }
  if (!res.ok) {
    const code = data.error_code || data.code || ''
    const msg = data.msg || data.message || data.error_description || ''
    throw new ErroDaNuvem(res.status, mensagemDoErro(res.status, code, msg, passo))
  }
  return data
}

function daResposta(data: RespostaAuth): Sessao {
  if (!data.access_token || !data.refresh_token) throw new ErroDaNuvem(500, mensagemDoErro(500, '', 'sem crachá', 'geral'))
  const expiraEm =
    typeof data.expires_at === 'number'
      ? data.expires_at * 1000
      : Date.now() + (data.expires_in ?? 3600) * 1000
  return {
    email: data.user?.email ?? '',
    userId: data.user?.id ?? '',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiraEm,
  }
}

async function guarda(nova: Sessao | null): Promise<void> {
  geracao++
  anterior = null // qualquer entrada ou saída aposenta a volta da troca
  anteriorGeracao = -1
  sessao = nova
  avisoDoLink = '' // recado velho não pode reaparecer numa entrada nova
  // Safari em aba privada, cota estourada, base despejada pelo iOS: o banco
  // pode recusar. Se isso derrubasse a função aqui, o app ficaria logado só na
  // memória, com a tela ainda oferecendo "Entrar" e um erro em inglês por cima.
  // Entrar sem gravar vale para esta sessão; a próxima abertura pede de novo
  try {
    await db.putKv('conta', nova)
  } catch {
    // segue: o notify abaixo é o que faz a tela contar a verdade
  }
  notify()
}

/** Passo 1: pede o e-mail com o código. Devolve o e-mail já arrumado. */
export async function pedirCodigo(emailBruto: string): Promise<string> {
  const problema = problemaNoEmail(emailBruto)
  if (problema) throw new Error(problema)
  const email = normalizaEmail(emailBruto)
  avisoDoLink = ''
  // o link do e-mail precisa voltar para ESTE endereço, e não para o padrão do
  // servidor; o endereço também tem de estar na lista de permitidos do painel
  const volta = encodeURIComponent(location.origin + location.pathname)
  await post('/otp?redirect_to=' + volta, { email, create_user: true }, 'email')
  return email
}

/** Passo 2: os 6 números do e-mail viram o crachá deste aparelho. */
export async function entrarComCodigo(emailBruto: string, codigoBruto: string): Promise<Conta> {
  const email = normalizaEmail(emailBruto)
  const codigo = normalizaCodigo(codigoBruto)
  if (!codigoCompleto(codigo)) throw new Error('Digite os números que chegaram no e-mail, são pelo menos 6.')
  const data = await post('/verify', { type: 'email', email, token: codigo }, 'codigo')
  const nova = daResposta(data)
  await guarda(nova)
  return { email: nova.email, userId: nova.userId }
}

// ---------- caminho do link ----------

interface CrachaDoLink {
  accessToken: string
  refreshToken: string
  expiraEm: number
}

/**
 * Tira o crachá (ou o erro) de dentro do endereço e limpa o endereço na hora.
 * É de propósito que isto seja síncrono: roda antes do primeiro desenho, para
 * o roteador por # do app não tropeçar no pedaço de crachá, e sem esperar rede
 * nenhuma, para nenhuma tela ficar em branco esperando um servidor.
 */
function pegaLinkDeEntrada(): CrachaDoLink | null {
  const bruto = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  if (!bruto.includes('access_token=') && !bruto.includes('error_code=') && !bruto.includes('error_description=')) {
    return null
  }
  const p = new URLSearchParams(bruto)
  history.replaceState(null, '', location.pathname + location.search + '#/more')

  const acesso = p.get('access_token')
  const renovacao = p.get('refresh_token')
  if (!acesso || !renovacao) {
    // link vencido ou já usado: o servidor manda o motivo pendurado no endereço
    avisoDoLink = mensagemDoErro(400, p.get('error_code') ?? '', p.get('error_description') ?? '', 'email')
    return null
  }
  const expiraEmSeg = Number(p.get('expires_at') || 0)
  return {
    accessToken: acesso,
    refreshToken: renovacao,
    expiraEm: expiraEmSeg ? expiraEmSeg * 1000 : Date.now() + Number(p.get('expires_in') || 3600) * 1000,
  }
}

/**
 * Só entra depois de o servidor dizer de quem é o crachá.
 * Sem esta conferência, um link mandado por qualquer pessoa trocaria a conta
 * deste aparelho em silêncio, e a biblioteca iria parar na conta dela.
 */
async function confereEEntra(cracha: CrachaDoLink): Promise<void> {
  // a conferência pode demorar segundos; se a pessoa sair ou entrar por outro
  // caminho enquanto isso, a resposta atrasada não pode trocar a conta dela
  const g = geracao
  try {
    const res = await comPrazo(AUTH + '/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + cracha.accessToken },
    })
    if (!res.ok) {
      if (g !== geracao) return
      avisoDoLink = 'Esse link não vale mais. Peça o código de novo pelo e-mail.'
      notify()
      return
    }
    const u = (await res.json()) as { id?: string; email?: string }
    if (g !== geracao) return
    // link de outra conta chegando por cima de quem já estava aqui: guarda o
    // crachá antigo para o "Cancelar" da folha poder devolver a conta certa
    const deAntes = sessao && sessao.userId !== u.id ? sessao : null
    await guarda({ ...cracha, email: u.email ?? '', userId: u.id ?? '' })
    anterior = deAntes // depois do guarda, que é quem zera esta volta
    anteriorGeracao = geracao
  } catch {
    if (g !== geracao) return
    avisoDoLink = 'Precisa de internet para terminar de entrar pelo link. Conecte e toque no link de novo.'
    notify()
  }
}

// ---------- renovação em silêncio ----------

/** Renova o crachá. Só desloga quando o servidor recusa o crachá de verdade. */
async function renova(): Promise<Sessao | null> {
  if (!sessao) return null
  if (renovando) return renovando
  const atual = sessao
  const g = geracao
  renovando = (async () => {
    try {
      const data = await post('/token?grant_type=refresh_token', { refresh_token: atual.refreshToken }, 'geral')
      if (g !== geracao) return sessao // saiu ou entrou com outra conta nesse meio tempo
      const nova = daResposta(data)
      // o /token nem sempre repete o e-mail: mantém o que já sabíamos
      await guarda({ ...nova, email: nova.email || atual.email, userId: nova.userId || atual.userId })
      return sessao
    } catch (e) {
      const status = e instanceof ErroDaNuvem ? e.status : 0
      // 0 sem internet, 429 pedidos demais, 5xx servidor fora, 403/404 portal de
      // wi-fi respondendo pelo servidor: nada disso é motivo para expulsar
      if (status === 400 || status === 401) await recusado(atual, g)
      return sessao
    } finally {
      renovando = null
    }
  })()
  return renovando
}

/**
 * O servidor recusou este crachá. Antes de deslogar, olha o que está gravado:
 * com duas abas abertas, a outra pode já ter renovado e girado o crachá, e aí
 * o certo é adotar o novo em vez de derrubar as duas.
 */
async function recusado(usado: Sessao, g: number): Promise<void> {
  if (g !== geracao) return
  let gravada: Sessao | null | undefined
  try {
    gravada = (await db.getKv('conta'))?.value as Sessao | null | undefined
  } catch {
    gravada = undefined // sem banco: decide só com o que está na memória
  }
  // reconfere DEPOIS da espera: entrar ou sair enquanto o banco respondia manda
  // mais do que a recusa de um crachá que já não é o desta pessoa
  if (g !== geracao) return
  if (gravada?.refreshToken && gravada.refreshToken !== usado.refreshToken) {
    await guarda(gravada) // outra aba já renovou e girou o crachá: adota o novo
    return
  }
  await guarda(null)
}

function renovaSePreciso(): void {
  if (!sessao || !navigator.onLine) return
  if (precisaRenovar(sessao, Date.now())) void renova()
}

/**
 * Crachá válido para falar com o servidor, ou null.
 * Quem chama decide o que fazer sem ele (offline, por exemplo, o app segue).
 */
export async function tokenDeAcesso(): Promise<string | null> {
  if (!sessao) return null
  if (tokenUtilizavel(sessao, Date.now())) return sessao.accessToken
  if (!navigator.onLine) return null
  const nova = await renova()
  return nova && tokenUtilizavel(nova, Date.now()) ? nova.accessToken : null
}

/** Quem está logado neste aparelho, ou null. */
export function contaAtual(): Conta | null {
  return sessao ? { email: sessao.email, userId: sessao.userId } : null
}

/**
 * Desfaz uma troca de conta que veio por link: devolve a sessão de antes.
 * Sem sessão anterior guardada, sai da conta (que é o certo: a pessoa não
 * quis entrar nesta).
 */
export async function desfazTroca(): Promise<void> {
  // só vale desfazer a troca que acabou de acontecer: se alguém entrou ou saiu
  // no meio, ressuscitar a conta velha seria pior do que sair
  const volta = anteriorGeracao === geracao ? anterior : null
  anterior = null
  anteriorGeracao = -1
  if (!volta) {
    await sair()
    return
  }
  await guarda(volta)
}

/** Sai da conta neste aparelho. Não apaga nenhuma música. */
export async function sair(): Promise<void> {
  const token = sessao && tokenUtilizavel(sessao, Date.now()) ? sessao.accessToken : null
  await guarda(null) // primeiro sai daqui: nenhuma resposta atrasada volta atrás
  if (token && navigator.onLine) {
    try {
      await post('/logout', {}, 'geral', token)
    } catch {
      // o crachá já foi embora daqui; o do servidor vence sozinho
    }
  }
}

/** Uma vez no boot, antes de desenhar a tela. Nunca joga erro, nunca espera rede. */
export async function initConta(): Promise<void> {
  const cracha = pegaLinkDeEntrada() // síncrono de propósito: limpa o # antes do 1º desenho
  try {
    const row = await db.getKv('conta')
    const guardada = row?.value as Sessao | null | undefined
    if (guardada?.accessToken && guardada.refreshToken) sessao = guardada
  } catch {
    // aparelho sem IndexedDB ou base recém-criada: segue deslogado
  }
  // a conferência do link e a renovação acontecem por fora: a tela desenha já
  if (cracha) void confereEEntra(cracha)
  else renovaSePreciso()

  // O link do e-mail pode chegar com o app JÁ ABERTO: no iPad e no iPhone o
  // navegador reaproveita a aba, e mudar só o # não recarrega a página. Sem
  // este ouvinte o crachá caía no roteador, não casava com rota nenhuma, a tela
  // piscava para Shows e a pessoa continuava de fora — mas o servidor já tinha
  // gasto o token de uso único, então clicar de novo dava "link inválido".
  window.addEventListener('hashchange', () => {
    const outro = pegaLinkDeEntrada()
    if (outro) void confereEEntra(outro)
    else if (avisoDoLink) notify()
  })

  window.addEventListener('online', renovaSePreciso)
  // um show inteiro com o app aberto passa da validade do crachá; ao voltar
  // para a frente do aparelho é a hora barata de renovar
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renovaSePreciso()
  })
}
