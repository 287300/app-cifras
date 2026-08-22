// Cliente do ajudante de busca (função no Supabase do Eder).
// Sempre uma ação humana por chamada: buscar uma vez, ler uma página escolhida.

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

const FN = 'https://sokdnapkjlmnfqjpjulz.supabase.co/functions/v1/cifra'
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNva2RuYXBramxtbmZxanBqdWx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNjYxNzIsImV4cCI6MjEwMjk0MjE3Mn0.QxqLX9IstqaZS5DaoGbjUWilfwRoxohlICUvRj1E8Ww'

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
