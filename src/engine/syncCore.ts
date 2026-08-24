// Núcleo puro da sincronização: derivação de chave e cifragem.
// Sem rede e sem banco, para dar para testar no bun.
//
// A palavra-chave nunca sai do aparelho: dela derivam-se
//   - o "endereço" da linha na nuvem (id, um hash), e
//   - a chave AES-GCM que embaralha o backup antes de subir.

const SALT = 'cifras-eder-sync-v1'

const te = new TextEncoder()
const td = new TextDecoder()

function toB64(buf: ArrayBuffer): string {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface DerivedSync {
  id: string // hex de 64 caracteres: identifica a linha na nuvem
  rawKey: string // base64 da chave AES-GCM (fica só no aparelho)
}

/** Deriva, da palavra-chave, o endereço na nuvem e a chave de cifragem. */
export async function deriveSync(word: string): Promise<DerivedSync> {
  const material = await crypto.subtle.importKey('raw', te.encode(word.trim()), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])
  const idBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: te.encode(SALT + '|id'), iterations: 120_000, hash: 'SHA-256' },
    material,
    256
  )
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te.encode(SALT + '|enc'), iterations: 120_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
  const raw = await crypto.subtle.exportKey('raw', aesKey)
  return { id: toHex(idBits), rawKey: toB64(raw) }
}

/** Recarrega a chave guardada no aparelho (base64) como CryptoKey. */
export function importRawKey(rawKey: string): Promise<CryptoKey> {
  const bytes = fromB64(rawKey)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

/** Embaralha o texto: "base64(iv).base64(cifrado)". */
export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text))
  return toB64(iv.buffer) + '.' + toB64(ct)
}

/** Desfaz o embaralhado; palavra-chave errada faz o subtle.decrypt rejeitar. */
export async function decryptText(key: CryptoKey, packed: string): Promise<string> {
  const dot = packed.indexOf('.')
  if (dot < 0) throw new Error('formato inválido')
  const iv = fromB64(packed.slice(0, dot))
  const ct = fromB64(packed.slice(dot + 1))
  const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBuf)
  return td.decode(plain)
}

/** Hash curto do conteúdo local, para pular envios idênticos. */
export async function contentHash(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', te.encode(text))
  return toHex(h).slice(0, 16)
}
