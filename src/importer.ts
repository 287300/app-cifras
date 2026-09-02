// Cliente do ajudante de busca (função no Supabase do Eder).
// Sempre uma ação humana por chamada: buscar uma vez, ler uma página escolhida.

import { FUNCOES, SUPABASE_ANON } from './supabase.ts'

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
const KEY = SUPABASE_ANON

const HEADERS = { apikey: KEY, Authorization: 'Bearer ' + KEY }

async function call<T>(params: string): Promise<T> {
  if (!navigator.onLine) throw new Error('Sem internet agora. A busca precisa de sinal; o que já está salvo continua funcionando.')
  let res: Response
  try {
    res = await fetch(FN + params, { headers: HEADERS })
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
  let res: Response
  try {
    res = await fetch(FN_VIDEO + '?q=' + encodeURIComponent(q.trim()), { headers: HEADERS })
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
