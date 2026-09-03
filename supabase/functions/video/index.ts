// Busca do clipe no YouTube para o modo ensaio do App de Cifras.
//
//   GET ?q=nome da musica artista  →  {hits:[{id, title, channel, length}]}
//
// Só devolve identificadores públicos de vídeo (o mesmo que a busca do
// YouTube mostra); quem toca é o player oficial embutido no app.

const ALLOWED_ORIGINS = new Set([
  'https://cifrapronta.com.br',
  'https://www.cifrapronta.com.br',
  'https://287300.github.io',
  // endereço antigo, mantido enquanto ele redireciona para o novo
  'https://cifrasdoeder.com.br',
  'https://www.cifrasdoeder.com.br',
  'http://localhost:8080',
  'http://localhost:8123',
  'http://localhost:8129',
])

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://cifrapronta.com.br',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function unescapeJson(s: string): string {
  // o trecho capturado já vem escapado como JSON: basta reabrir como string
  try {
    return JSON.parse('"' + s + '"') as string
  } catch {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

interface Hit {
  id: string
  title: string
  channel: string
  length: string
}

function extractHits(html: string): Hit[] {
  const hits: Hit[] = []
  const seen = new Set<string>()
  const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && hits.length < 6) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    const win = html.slice(m.index, m.index + 2500)
    const tm = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(win)
    const cm =
      /"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(win) ??
      /"longBylineText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(win) ??
      /"shortBylineText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(win)
    const lm =
      /"lengthText":\{[\s\S]{0,300}?"simpleText":"([0-9:]{3,9})"/.exec(win) ??
      /"simpleText":"([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)"/.exec(win)
    if (!tm) continue
    hits.push({
      id,
      title: unescapeJson(tm[1]).slice(0, 120),
      channel: cm ? unescapeJson(cm[1]).slice(0, 60) : '',
      length: lm ? lm[1] : '',
    })
  }
  return hits
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'GET') return json({ error: 'somente GET' }, 405, origin)

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 120)
  if (q.length < 2) return json({ error: 'busca vazia' }, 400, origin)

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12_000)
    let html: string
    try {
      const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&hl=pt-BR', {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error('youtube respondeu ' + res.status)
      html = await res.text()
    } finally {
      clearTimeout(timer)
    }
    return json({ hits: extractHits(html) }, 200, origin)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }
})
