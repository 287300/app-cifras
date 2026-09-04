// Cliente do ajudante de busca (função no Supabase do Eder).
// Sempre uma ação humana por chamada: buscar uma vez, ler uma página escolhida.
//
// A busca vai com o CRACHÁ DA PESSOA, não com a chave pública do app. A chave
// pública está dentro do app.js, que é um arquivo aberto na internet: quem a
// copiasse usava o buscador do Eder como proxy anônimo, na conta e na fatura
// dele. Com o crachá, cada chamada tem um dono conhecido.

import { FUNCOES, SUPABASE_ANON } from './supabase.ts'
import { tokenDeAcesso } from './conta.ts'

const SEM_CONTA = 'Entre com o seu e-mail para usar a busca. O que já está salvo continua funcionando sem conta.'

/** Cabeçalhos com o crachá da pessoa. Sem conta, ninguém busca. */
async function cabecalhos(): Promise<Record<string, string>> {
  const token = await tokenDeAcesso()
  if (!token) throw new Error(SEM_CONTA)
  return { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token }
}

export interface SearchHit {
  title: string
  url: string
  host: string
}

export interface FetchedCifra {
  title: string
  artist: string
  tom: string | null
  body: string
  sourceUrl: string
  host: string
  weak: boolean
}

const FN = FUNCOES + '/cifra'

async function call<T>(params: string): Promise<T> {
  if (!navigator.onLine) throw new Error('Sem internet agora. A busca precisa de sinal; o que já está salvo continua funcionando.')
  const headers = await cabecalhos()
  let res: Response
  try {
    res = await fetch(FN + params, { headers })
  } catch {
    throw new Error('Não consegui falar com o buscador. Confira o sinal e tente de novo.')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok || data.error) throw new Error(data.error || 'O buscador respondeu com erro ' + res.status)
  return data
}

/** Busca por nome de música e banda; devolve títulos e links (nada de conteúdo). */
export async function searchCifras(q: string): Promise<SearchHit[]> {
  const data = await call<{ hits: SearchHit[] }>('?op=search&q=' + encodeURIComponent(q.trim()))
  return data.hits ?? []
}

/** Lê a página escolhida pelo usuário e devolve a cifra extraída. */
export async function fetchCifraFromUrl(url: string): Promise<FetchedCifra> {
  return await call<FetchedCifra>('?op=fetch&url=' + encodeURIComponent(url))
}

// ---------- clipe para ensaiar junto ----------

export interface VideoHit {
  id: string
  title: string
  channel: string
  length: string
}

const FN_VIDEO = FUNCOES + '/video'

/** Procura o clipe no YouTube pelo nome da música e do artista. */
export async function searchVideos(q: string): Promise<VideoHit[]> {
  if (!navigator.onLine) throw new Error('O vídeo precisa de internet. No palco, a cifra continua funcionando sozinha.')
  const headers = await cabecalhos()
  let res: Response
  try {
    res = await fetch(FN_VIDEO + '?q=' + encodeURIComponent(q.trim()), { headers })
  } catch {
    throw new Error('Não consegui falar com o buscador de vídeos. Confira o sinal.')
  }
  const data = (await res.json().catch(() => ({}))) as { hits?: VideoHit[]; error?: string }
  if (!res.ok || data.error) throw new Error(data.error || 'O buscador respondeu com erro ' + res.status)
  return data.hits ?? []
}

/** Aceita link do YouTube em qualquer formato e devolve só o identificador. */
export function videoIdFromUrl(raw: string): string | null {
  const s = raw.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  const m =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(s) ??
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(s) ??
    /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/.exec(s)
  return m ? m[1] : null
}
