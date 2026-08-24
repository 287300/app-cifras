// O carteiro entre aparelhos: guarda uma cópia cifrada das músicas na nuvem
// e busca a versão mais nova ao abrir o app. O MERGE é sempre local, via
// store.importData (nunca apaga; só adiciona ou atualiza o mais recente).
//
// Regras de segurança de palco:
//   - nada roda enquanto a rota é #/play (nunca mexe na tela no meio do show);
//   - a nuvem vazia nunca "limpa" um aparelho cheio (só recebe o 1º envio);
//   - envio idêntico ao anterior é pulado (hash local);
//   - conflito (409) = mescla local e reenvia, uma vez por rodada.

import { db } from './db.ts'
import { store } from './store.ts'
import { contentHash, decryptText, deriveSync, encryptText, importRawKey } from './engine/syncCore.ts'

const FN = 'https://sokdnapkjlmnfqjpjulz.supabase.co/functions/v1/sync'
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNva2RuYXBramxtbmZxanBqdWx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNjYxNzIsImV4cCI6MjEwMjk0MjE3Mn0.QxqLX9IstqaZS5DaoGbjUWilfwRoxohlICUvRj1E8Ww'

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
}

let kv: SyncKv | null = null
let cryptoKey: CryptoKey | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let applying = false // aplicando pull: não agendar push por causa desses emits
let busy = false
let lastSyncAt = 0
let lastError = ''
let pendingPull = false
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
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

async function call(body: Record<string, unknown>): Promise<Response> {
  return fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body),
  })
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

/** Liga a sincronização neste aparelho com a palavra-chave do Eder. */
export async function enableSync(word: string, device: string): Promise<void> {
  if (word.trim().length < 4) throw new Error('Use uma palavra-chave com pelo menos 4 letras.')
  const derived = await deriveSync(word)
  cryptoKey = await importRawKey(derived.rawKey)
  kv = {
    enabled: true,
    id: derived.id,
    rawKey: derived.rawKey,
    device: device.trim() || 'Aparelho',
    lastSeen: 0,
    lastHash: '',
  }
  await saveKv()
  await pullNow() // 1º passo é sempre olhar a nuvem; o envio vem em seguida
  if (lastError) {
    const msg = lastError
    await disableSync() // ativação só fica de pé com a 1ª sincronização ok
    throw new Error(msg)
  }
  notify()
}

/** Desliga neste aparelho (não mexe na nuvem nem nas músicas locais). */
export async function disableSync(): Promise<void> {
  kv = { enabled: false, id: '', rawKey: '', device: '', lastSeen: 0, lastHash: '' }
  cryptoKey = null
  await saveKv()
  notify()
}

export function syncStatus(): SyncStatus {
  return { enabled: !!kv?.enabled, device: kv?.device ?? '', lastSyncAt, busy, error: lastError }
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
      cryptoKey = null
      kv = null
      return
    }
  }
  store.subscribe(schedulePush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pullNow()
  })
  window.addEventListener('online', () => void pullNow())
  window.addEventListener('hashchange', () => {
    if (pendingPull && !inPlay()) {
      pendingPull = false
      void pullNow()
    }
  })
  if (kv?.enabled) void pullNow()
}

/** Nome padrão amigável para este aparelho. */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  return 'Computador'
}
