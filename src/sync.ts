// O carteiro entre aparelhos: guarda uma cópia cifrada das músicas na nuvem
// e busca a versão mais nova ao abrir o app. O MERGE é sempre local, via
// store.importData (nunca apaga; só adiciona ou atualiza o mais recente).
//
// Regras de segurança de palco:
//   - nada roda enquanto a rota é #/play (nunca mexe na tela no meio do show);
//   - a nuvem vazia nunca "limpa" um aparelho cheio (só recebe o 1º envio);
//   - envio idêntico ao anterior é pulado (hash local);
//   - conflito (409) = mescla local e reenvia, uma vez por rodada.
//
// A nuvem é recurso da assinatura (ticket 17). Duas coisas continuam valendo
// exatamente como antes disso:
//
//   - A CONTA NÃO É A CHAVE. Ela prova ao servidor quem pode gravar e ler
//     aquela linha; o conteúdo continua cifrado com um segredo que só existe
//     nos aparelhos. Servidor nenhum lê música, observação ou nome de show.
//   - PARAR DE PAGAR NÃO DESLIGA. A chave do conjunto continua guardada e a
//     sincronização apenas fica parada. Voltando o plano, ela volta sozinha,
//     sem parear os aparelhos de novo.

import { contaAtual, onContaChange, tokenDeAcesso } from './conta.ts'
import { db } from './db.ts'
import { onLicencaChange, planoAtual } from './licenca.ts'
import { store } from './store.ts'
import { FUNCOES, SUPABASE_ANON } from './supabase.ts'
import { bloqueioDaSincronizacao, bloqueioDoServidor, textoDoBloqueio, type Bloqueio } from './engine/sincronizacao.ts'
import {
  contentHash,
  decryptText,
  deriveFromSecret,
  encryptText,
  importRawKey,
  keyFromCode,
  newPairCode,
  pairIdFromCode,
  randomSecret,
} from './engine/syncCore.ts'

const FN = FUNCOES + '/sync'
const KEY = SUPABASE_ANON

interface SyncKv {
  enabled: boolean
  id: string
  rawKey: string
  device: string
  lastSeen: number // updated_at da nuvem visto por último (base para detectar conflito)
  lastHash: string // hash do último conteúdo local enviado
}

export interface SyncStatus {
  enabled: boolean
  device: string
  lastSyncAt: number
  busy: boolean
  error: string
  /** Por que a nuvem está fora de alcance agora ('nenhum' quando está tudo certo). */
  bloqueio: Bloqueio
}

// De quanto em quanto tempo o app aberto olha a nuvem sozinho. Sem isso, um
// aparelho que fica na tela (o iPad no ensaio) só descobre novidade quando
// alguém sai e volta para o app.
// (?ronda=1000 no endereço encurta a ronda: é o gancho usado pelos testes)
const RONDA_MS = Number(new URLSearchParams(location.search).get('ronda')) || 45_000
// Piso entre duas buscas seguidas, para o foco não virar enxurrada de buscas.
const PISO_MS = Math.min(10_000, RONDA_MS)

let kv: SyncKv | null = null
let cryptoKey: CryptoKey | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let ronda: ReturnType<typeof setInterval> | null = null
let applying = false // aplicando pull: não agendar push por causa desses emits
let busy = false
let lastSyncAt = 0
let lastError = ''
let pendingPull = false
/**
 * A última recusa que veio DO SERVIDOR.
 *
 * Guardada à parte do que este aparelho sabe, porque os dois podem discordar:
 * a assinatura pode ter acabado cinco minutos atrás e o aparelho ainda não
 * saber. Quando isso acontece, quem manda é o servidor.
 */
let recusaDoServidor: Bloqueio = 'nenhum'
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

/** O que este aparelho sabe agora sobre poder ou não falar com a nuvem. */
function bloqueioLocal(): Bloqueio {
  return bloqueioDaSincronizacao({ temConta: contaAtual() !== null, plano: planoAtual() })
}

/**
 * A resposta que vale, lida na hora.
 *
 * Lida na hora de propósito: guardar isto numa variável já custou caro uma
 * vez. Conta e licença chegam do banco do aparelho depois do primeiro desenho
 * da tela, e um valor congelado no arranque deixava o cartão dizendo que
 * estava tudo certo enquanto o app não sincronizava nada.
 */
function bloqueioAtual(): Bloqueio {
  const local = bloqueioLocal()
  return local !== 'nenhum' ? local : recusaDoServidor
}

/**
 * Anota a recusa do servidor e devolve true quando ela mudou.
 *
 * Recusa apaga o recado técnico de propósito: "nuvem respondeu 402" ao lado de
 * "sincronizar é recurso da assinatura" só confunde quem lê.
 */
function marcaBloqueio(b: Bloqueio): boolean {
  if (recusaDoServidor === b) return false
  recusaDoServidor = b
  if (b !== 'nenhum') lastError = ''
  return true
}

async function saveKv(): Promise<void> {
  if (kv) await db.putKv('sync', kv)
}

function inPlay(): boolean {
  return location.hash.startsWith('#/play')
}

function serialize(): string {
  // sem os ajustes: fonte de palco é por aparelho, não viaja
  return JSON.stringify({
    app: 'cifras',
    version: 1,
    songs: [...store.songs.values()],
    shows: [...store.shows.values()],
  })
}

/**
 * Chama a nuvem com o crachá da pessoa.
 *
 * A chave pública (apikey) abre a porta da função; o crachá diz QUEM está
 * entrando. Sem crachá utilizável não há chamada nenhuma: o servidor recusaria
 * de qualquer jeito, e uma ida à rede para tomar 401 só gasta bateria.
 */
async function call(body: Record<string, unknown>): Promise<Response> {
  const token = await tokenDeAcesso()
  if (!token) {
    marcaBloqueio('sem-conta')
    throw new Error(textoDoBloqueio('sem-conta') as string)
  }
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  // recusa do servidor manda mais do que a conta deste aparelho: a assinatura
  // pode ter acabado dois minutos atrás, e é ele quem está vendo isso
  const doServidor = bloqueioDoServidor(res.status)
  if (doServidor !== 'nenhum') {
    marcaBloqueio(doServidor)
    // sem esta linha a recusa do servidor virava um estado que reavalia() não
    // reconhecia como mudança: quando o plano voltasse, ela sairia sem religar
    // a ronda, e a sincronização só voltaria mandando o app para segundo plano
    ultimoAvisado = bloqueioAtual()
    paraRonda()
    notify()
    throw new Error(textoDoBloqueio(doServidor) as string)
  }
  if (res.ok && marcaBloqueio('nenhum')) {
    ultimoAvisado = bloqueioAtual()
    notify()
  }
  return res
}

/**
 * A porta de entrada de tudo o que fala com a nuvem.
 *
 * Devolve false, sem erro nenhum, quando este aparelho já sabe que não pode:
 * o cartão de sincronização explica o motivo, e ninguém precisa ver um erro
 * para descobrir que a assinatura acabou.
 */
function liberadoParaRede(): boolean {
  const b = bloqueioAtual()
  if (b !== 'nenhum') paraRonda()
  return b === 'nenhum'
}

async function applyRemote(packed: string, updatedAt: number): Promise<void> {
  if (!cryptoKey || !kv) return
  const json = await decryptText(cryptoKey, packed)
  const data = JSON.parse(json) as { app?: string; songs?: unknown }
  if (data.app !== 'cifras' || !Array.isArray(data.songs)) throw new Error('backup da nuvem inválido')
  applying = true
  try {
    await store.importData(json)
  } finally {
    applying = false
  }
  kv.lastSeen = updatedAt
  await saveKv()
  // listas na tela se reconstroem sozinhas; formulários e o palco ficam em paz
  if (location.hash === '' || /^#\/(shows|library)/.test(location.hash)) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

/** Busca a versão da nuvem e mescla; depois envia o que este aparelho tiver a mais. */
export async function pullNow(): Promise<void> {
  if (!kv?.enabled || !cryptoKey || busy) return
  if (!navigator.onLine) return
  if (inPlay()) {
    pendingPull = true
    return
  }
  if (!liberadoParaRede()) return
  busy = true
  lastError = ''
  notify()
  try {
    const res = await call({ op: 'pull', id: kv.id })
    const data = (await res.json()) as { empty?: boolean; payload?: string; updatedAt?: number }
    if (!res.ok) throw new Error((data as { error?: string }).error || 'nuvem respondeu ' + res.status)
    if (data.empty) {
      // nuvem ainda vazia: se este aparelho tem conteúdo, faz o 1º envio
      if (store.songs.size > 0) await pushNow(true)
    } else if (data.payload && typeof data.updatedAt === 'number') {
      if (data.updatedAt > kv.lastSeen) await applyRemote(data.payload, data.updatedAt)
      // o que este aparelho tiver além da nuvem sobe em seguida
      await pushNow(true)
    }
    lastSyncAt = Date.now()
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'falhou'
  } finally {
    busy = false
    notify()
  }
}

/** Envia o conteúdo local (pulando envios idênticos); em conflito, mescla e tenta 1 vez. */
export async function pushNow(fromPull = false): Promise<void> {
  if (!kv?.enabled || !cryptoKey) return
  if (!navigator.onLine) return
  if (!fromPull && busy) return
  if (!liberadoParaRede()) return
  if (!fromPull) {
    busy = true
    lastError = ''
    notify()
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const json = serialize()
      const hash = await contentHash(json)
      if (hash === kv.lastHash && kv.lastSeen > 0) break // nada mudou desde o último envio
      if (store.songs.size === 0 && kv.lastSeen > 0) break // aparelho vazio nunca sobrepõe nuvem já usada
      const payload = await encryptText(cryptoKey, json)
      const res = await call({ op: 'push', id: kv.id, payload, device: kv.device, baseUpdatedAt: kv.lastSeen })
      const data = (await res.json()) as { ok?: boolean; updatedAt?: number; conflict?: boolean; payload?: string; error?: string }
      if (res.status === 409 && data.conflict && data.payload && typeof data.updatedAt === 'number') {
        await applyRemote(data.payload, data.updatedAt) // mescla o que chegou e tenta de novo
        continue
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'nuvem respondeu ' + res.status)
      kv.lastSeen = data.updatedAt ?? Date.now()
      kv.lastHash = hash
      await saveKv()
      break
    }
    lastSyncAt = Date.now()
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'falhou'
  } finally {
    if (!fromPull) {
      busy = false
      notify()
    }
  }
}

function schedulePush(): void {
  if (!kv?.enabled || applying) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void pushNow()
  }, 4000)
}

/**
 * Envio pendente vai agora: usado quando o app sai da frente ou vai fechar.
 *
 * O detalhe que parece bobo e não é: se uma sincronização já estiver no ar,
 * pushNow desiste na hora por causa da trava de ocupado. Como o timer já foi
 * cancelado aqui, o envio pendente sumiria em silêncio, justamente no momento
 * em que o app está sendo fechado. Por isso esperamos a que está rodando.
 */
function flushPush(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  void (async () => {
    for (let i = 0; i < 20 && busy; i++) await new Promise((r) => setTimeout(r, 100))
    await pushNow()
  })()
}

/** Busca com piso de tempo, para foco e ronda não virarem enxurrada. */
function pullSePassouTempo(): void {
  if (Date.now() - lastSyncAt < PISO_MS) return
  void pullNow()
}

function ligaRonda(): void {
  if (ronda || !kv?.enabled) return
  if (bloqueioAtual() !== 'nenhum') return // parada por conta ou plano: não fica batendo à toa
  ronda = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (inPlay()) return // no palco ninguém mexe na tela
    void pullNow()
  }, RONDA_MS)
}

function paraRonda(): void {
  if (!ronda) return
  clearInterval(ronda)
  ronda = null
}

/**
 * Recusa em forma de erro, para as ações que a pessoa disparou de propósito.
 *
 * Ligar, gerar código e usar código são toques deliberados: aí a frase precisa
 * chegar. As rondas e os envios automáticos ficam quietos, porque ninguém pediu
 * nada e um alerta no meio do ensaio não ajuda em nada.
 */
function exigeLiberado(): void {
  const b = bloqueioAtual()
  if (b !== 'nenhum') throw new Error(textoDoBloqueio(b) as string)
}

/** Liga a sincronização sozinha: o app sorteia o segredo, sem senha nenhuma. */
export async function enableSync(device: string): Promise<void> {
  exigeLiberado()
  const derived = await deriveFromSecret(randomSecret())
  await activate(derived.id, derived.rawKey, device)
}

/**
 * Passa a valer um conjunto neste aparelho: guarda a chave, olha a nuvem e liga
 * a ronda.
 *
 * `guardaChaveMesmoFalhando` existe por causa de um caso que já custou caro:
 * o código de 6 números é de USO ÚNICO e o servidor apaga a linha dele ANTES de
 * responder. Se a primeira busca falhasse por qualquer motivo passageiro (o
 * banco piscando, um 502) e o app apagasse a chave, a pessoa ficaria com o
 * código queimado E sem chave: teria de gerar outro no aparelho antigo. Pior,
 * um aparelho que já sincronizava perderia também o conjunto anterior.
 *
 * Por isso: quem chegou pelo código GUARDA a chave e tenta de novo depois; só o
 * "ligar do zero", que não gasta nada de ninguém, desfaz a ativação ao falhar.
 */
async function activate(id: string, rawKey: string, device: string, guardaChaveMesmoFalhando = false): Promise<void> {
  cryptoKey = await importRawKey(rawKey)
  kv = { enabled: true, id, rawKey, device: device.trim() || 'Aparelho', lastSeen: 0, lastHash: '' }
  await saveKv()
  await pullNow() // 1º passo é sempre olhar a nuvem; o envio vem em seguida
  if (lastError) {
    const msg = lastError
    if (!guardaChaveMesmoFalhando) {
      await disableSync() // ativação só fica de pé com a 1ª sincronização ok
      throw new Error(msg)
    }
    // a chave fica: a ronda e o próximo retorno à frente do aparelho tentam de
    // novo sozinhos, e a pessoa não perde o código que já usou
    ligaRonda()
    notify()
    throw new Error(msg + ' O código já foi usado, então não peça outro: deixe o app aberto com internet que ele tenta sozinho.')
  }
  ligaRonda()
  notify()
}

/**
 * Gera o código de 6 dígitos que liga outro aparelho a este conjunto.
 * O segredo viaja embrulhado pelo próprio código e o servidor guarda por
 * 10 minutos, para um único resgate.
 */
export async function createPairCode(): Promise<string> {
  if (!kv?.enabled) throw new Error('Ligue a sincronização neste aparelho primeiro.')
  if (!navigator.onLine) throw new Error('Precisa de internet para gerar o código.')
  exigeLiberado()
  const code = newPairCode()
  const wrapped = await encryptText(await keyFromCode(code), JSON.stringify({ id: kv.id, rawKey: kv.rawKey }))
  const res = await call({ op: 'pair-create', pairId: await pairIdFromCode(code), payload: wrapped })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error || 'não deu para gerar o código')
  return code
}

/** Usa o código mostrado no outro aparelho e entra no mesmo conjunto. */
export async function claimPairCode(code: string, device: string): Promise<void> {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 6) throw new Error('O código tem 6 números.')
  if (!navigator.onLine) throw new Error('Precisa de internet para usar o código.')
  exigeLiberado()
  const res = await call({ op: 'pair-claim', pairId: await pairIdFromCode(digits) })
  const data = (await res.json()) as { payload?: string; error?: string }
  if (!res.ok || !data.payload) throw new Error(data.error || 'código inválido')
  let parsed: { id?: string; rawKey?: string }
  try {
    parsed = JSON.parse(await decryptText(await keyFromCode(digits), data.payload)) as { id?: string; rawKey?: string }
  } catch {
    throw new Error('Código errado. Confira os 6 números no outro aparelho.')
  }
  if (!parsed.id || !parsed.rawKey) throw new Error('Código inválido.')
  // o código já foi gasto no servidor: a chave fica mesmo se a busca falhar
  await activate(parsed.id, parsed.rawKey, device, true)
}

/** Desliga neste aparelho (não mexe na nuvem nem nas músicas locais). */
export async function disableSync(): Promise<void> {
  // para tudo o que estava agendado antes de esquecer a chave, senão sobra
  // uma ronda batendo na nuvem de um conjunto que este aparelho não é mais
  paraRonda()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  kv = { enabled: false, id: '', rawKey: '', device: '', lastSeen: 0, lastHash: '' }
  cryptoKey = null
  await saveKv()
  notify()
}

export function syncStatus(): SyncStatus {
  return { enabled: !!kv?.enabled, device: kv?.device ?? '', lastSyncAt, busy, error: lastError, bloqueio: bloqueioAtual() }
}

/**
 * Voltou a poder: retoma sem pedir nada a ninguém.
 *
 * É este pedaço que cumpre a promessa de "voltar a pagar não pede pareamento
 * de novo". A chave do conjunto nunca foi apagada, então basta destravar,
 * religar a ronda e buscar o que mudou enquanto o app estava parado.
 */
let ultimoAvisado: Bloqueio | null = null
function reavalia(): void {
  const local = bloqueioLocal()
  // conta ou plano voltaram: a recusa que o servidor deu antes está velha, e
  // segurar nela impediria justamente a primeira tentativa depois da compra
  if (local === 'nenhum') marcaBloqueio('nenhum')
  const agora = bloqueioAtual()
  if (agora === ultimoAvisado) return
  ultimoAvisado = agora
  notify()
  if (agora !== 'nenhum') {
    paraRonda()
    return
  }
  if (!kv?.enabled || inPlay()) return // no palco ninguém mexe na tela
  ligaRonda()
  void pullNow()
}

export function onSyncChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Chamado uma vez no boot, depois do store.init(). */
export async function initSync(): Promise<void> {
  const row = await db.getKv('sync')
  const saved = row?.value as SyncKv | undefined
  if (saved?.enabled && saved.id && saved.rawKey) {
    kv = saved
    try {
      cryptoKey = await importRawKey(saved.rawKey)
    } catch {
      // chave guardada ilegível: esquece o conjunto, mas NÃO sai daqui. Sair
      // deixava o app sem os ouvintes de conta, licença e fechamento pelo resto
      // da sessão, e o cartão congelado na primeira pintura
      cryptoKey = null
      kv = null
    }
  }
  store.subscribe(schedulePush)
  // conta e plano são as duas coisas que ligam e desligam a nuvem; as duas
  // mudam por fora daqui (entrar, sair, comprar, deixar vencer)
  onContaChange(reavalia)
  onLicencaChange(reavalia)
  // a licença pode ter terminado de carregar antes destes ouvintes existirem;
  // este aviso é o que conserta o cartão que já foi desenhado
  ultimoAvisado = bloqueioAtual()
  notify()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void pullNow()
      ligaRonda()
    } else {
      // saindo da frente: o que estava esperando os 4 s vai agora, senão
      // o aparelho pode ser fechado antes do envio
      flushPush()
      paraRonda()
    }
  })
  // fechar a aba ou o app: última chance de mandar o que ficou pendente
  window.addEventListener('pagehide', flushPush)
  window.addEventListener('focus', pullSePassouTempo)
  window.addEventListener('online', () => void pullNow())
  window.addEventListener('hashchange', () => {
    if (pendingPull && !inPlay()) {
      pendingPull = false
      void pullNow()
    }
  })
  if (kv?.enabled && bloqueioAtual() === 'nenhum') {
    void pullNow()
    ligaRonda()
  }
}

/** Nome padrão amigável para este aparelho. */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  return 'Computador'
}
