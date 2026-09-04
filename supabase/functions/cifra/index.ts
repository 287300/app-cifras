// Ajudante de busca do App de Cifras (uso pessoal do Eder).
//
// Duas operações, sempre disparadas por um toque do usuário no app:
//   ?op=search&q=...   busca na internet e devolve uma lista de links (só títulos e URLs)
//   ?op=fetch&url=...  lê UMA página escolhida pelo usuário e devolve o texto da cifra
//
// Guardas: nada de varredura ou fila; uma página por chamada, tamanho limitado,
// somente http(s) público, e origem restrita ao app.
//
// TODA CHAMADA EXIGE O CRACHÁ DE UMA PESSOA (revisão de 04/09/2026). Três
// coisas que valem explicação:
//
// 1. A função exige um JWT válido para ser chamada, mas a chave pública do app
//    também é um JWT válido, e ela mora dentro do app.js, que é um arquivo
//    aberto na internet. Sem conferir QUEM está pedindo, isto aqui era um
//    proxy web anônimo rodando na conta e na fatura do Eder.
//
// 2. O CORS não é portão. Ele só existe quando o navegador manda o cabeçalho
//    Origin; um cliente de linha de comando não manda nenhum. Agora a falta de
//    Origin conhecida também é recusa, e o crachá é o portão de verdade.
//
// 3. Redirecionamento é seguido À MÃO, um salto por vez, revalidando o endereço
//    a cada salto. Com 'follow' automático, a validação do endereço inicial não
//    valia nada: bastava um host que responde 302 para um endereço interno.

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

// ---------- quem está pedindo ----------

const BASE = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Quem é o dono deste crachá, segundo o servidor de contas. Null se não vale. */
async function quemE(token: string): Promise<string | null> {
  if (!token) return null
  const res = await fetch(BASE + '/auth/v1/user', {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + token },
  })
  if (!res.ok) return null
  const u = (await res.json()) as { email?: string }
  const email = (u.email ?? '').trim().toLowerCase()
  return email || null
}

// ---------- utilidades de texto ----------

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ntilde: 'ñ',
    aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', eacute: 'é', ecirc: 'ê',
    iacute: 'í', oacute: 'ó', otilde: 'õ', ocirc: 'ô', uacute: 'ú', ccedil: 'ç',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ccedil: 'Ç',
  }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? m)
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
}

/**
 * Lê a resposta até um teto de bytes e para.
 *
 * `res.text()` lê o que vier: uma resposta gigante de um motor de busca comeria
 * a memória da função. O teto vale para todas as leituras, não só para a página
 * de cifra.
 */
async function textoLimitado(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < max) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  void reader.cancel().catch(() => undefined)
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, total - off)), off)
    off += c.byteLength
    if (off >= total) break
  }
  return new TextDecoder('utf-8').decode(buf)
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ---------- validação de URL (só páginas públicas) ----------

function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  // porta esquisita é sinal de serviço interno, não de página de cifra
  if (u.port !== '' && u.port !== '80' && u.port !== '443') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return false
  // nome sem ponto é máquina da rede interna ("kong", "db", "metadata")
  if (!h.includes('.')) return false
  // IPv6 entre colchetes, e IPv4 em qualquer grafia: o padrão de URL já
  // normaliza decimal, octal e hexadecimal para a forma com pontos
  if (h.includes(':') || h.startsWith('[')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false
  return true
}

// ---------- busca (motores com resultado renderizado no servidor) ----------

interface Hit {
  title: string
  url: string
  host: string
}

const PREFERRED_HOSTS = ['cifraclub.com.br', 'cifras.com.br', 'e-chords.com', 'letras.mus.br']
const BLOCKED_HOSTS = ['youtube.com', 'spotify.com', 'wikipedia.org', 'instagram.com', 'facebook.com', 'tiktok.com', 'apple.com', 'play.google.com', 'duckduckgo.com', 'bing.com', 'microsoft.com', 'smartcifra.app']

function rankHits(hits: Hit[]): Hit[] {
  const seen = new Set<string>()
  const unique = hits.filter((h) => {
    const key = h.url.replace(/[#?].*$/, '')
    if (seen.has(key) || !h.host || BLOCKED_HOSTS.some((b) => h.host.endsWith(b))) return false
    seen.add(key)
    return true
  })
  return unique
    .sort((a, b) => {
      const pa = PREFERRED_HOSTS.findIndex((p) => a.host.endsWith(p))
      const pb = PREFERRED_HOSTS.findIndex((p) => b.host.endsWith(p))
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
    })
    .slice(0, 8)
}

/** Busca oficial de sugestões do Cifra Club (feita para busca por nome; devolve só títulos e links). */
async function searchCifraClubSuggest(q: string): Promise<Hit[]> {
  const res = await fetch('https://solr.sscdn.co/cc/h2/?q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) return []
  const raw = await textoLimitado(res, MAX_BUSCA)
  const jsonStart = raw.indexOf('(')
  const body = jsonStart >= 0 && raw.trim().endsWith(')') ? raw.slice(jsonStart + 1, raw.lastIndexOf(')')) : raw
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  const docs =
    (data as { response?: { docs?: unknown[] } }).response?.docs ??
    (data as { docs?: unknown[] }).docs ??
    (Array.isArray(data) ? (data as unknown[]) : [])
  const hits: Hit[] = []
  for (const d of docs as Record<string, unknown>[]) {
    const dns = typeof d.d === 'string' ? d.d : typeof d.dns === 'string' ? d.dns : ''
    const slug = typeof d.u === 'string' ? d.u : typeof d.url === 'string' ? d.url : ''
    const song = typeof d.m === 'string' ? d.m : typeof d.t === 'string' ? d.t : ''
    const artist = typeof d.a === 'string' ? d.a : ''
    if (!dns || !slug) continue
    hits.push({
      title: (song || slug) + (artist ? ' · ' + artist : ''),
      url: 'https://www.cifraclub.com.br/' + dns + '/' + slug + '/',
      host: 'cifraclub.com.br',
    })
  }
  return hits
}

async function searchDuckDuckGo(q: string): Promise<Hit[]> {
  const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
  })
  if (!res.ok) return []
  const html = await textoLimitado(res, MAX_BUSCA)
  const hits: Hit[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let href = decodeEntities(m[1])
    const uddg = /[?&]uddg=([^&]+)/.exec(href)
    if (uddg) href = decodeURIComponent(uddg[1])
    if (!isPublicHttpUrl(href)) continue
    hits.push({ title: stripTags(m[2]).trim(), url: href, host: hostOf(href) })
  }
  return hits
}

async function searchBing(q: string): Promise<Hit[]> {
  const res = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=pt-BR', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
  })
  if (!res.ok) return []
  const html = await textoLimitado(res, MAX_BUSCA)
  const hits: Hit[] = []
  const re = /<li class="b_algo"[\s\S]*?<a[^>]+href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1])
    if (!isPublicHttpUrl(href)) continue
    hits.push({ title: stripTags(m[2]).trim(), url: href, host: hostOf(href) })
  }
  return hits
}

// ---------- leitura de uma página de cifra ----------

const MAX_BYTES = 600_000
/** Teto para a resposta de um motor de busca. */
const MAX_BUSCA = 400_000
const MAX_SALTOS = 3

async function fetchPage(url: string): Promise<{ finalUrl: string; html: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  try {
    // Um salto por vez, conferindo o endereço a cada um. Seguir redirecionamento
    // automaticamente anularia a conferência: o primeiro endereço passa e o
    // segundo, que é o que de fato será lido, ninguém olha.
    let alvo = url
    let res: Response | null = null
    for (let salto = 0; salto <= MAX_SALTOS; salto++) {
      if (!isPublicHttpUrl(alvo)) throw new Error('endereço inválido')
      res = await fetch(alvo, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,*/*;q=0.5' },
        signal: ctrl.signal,
        redirect: 'manual',
      })
      if (res.status < 300 || res.status > 399) break
      const destino = res.headers.get('location')
      void res.body?.cancel().catch(() => undefined)
      if (!destino) throw new Error('página respondeu ' + res.status)
      alvo = new URL(destino, alvo).toString()
      res = null
    }
    if (!res) throw new Error('a página encaminha demais')
    if (!res.ok) throw new Error('página respondeu ' + res.status)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) throw new Error('não é uma página de texto')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('sem corpo')
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
    void reader.cancel().catch(() => undefined)
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      buf.set(c.subarray(0, Math.min(c.byteLength, total - off)), off)
      off += c.byteLength
      if (off >= total) break
    }
    return { finalUrl: alvo, html: new TextDecoder('utf-8').decode(buf) }
  } finally {
    clearTimeout(timer)
  }
}

function extractCifra(html: string, finalUrl: string) {
  // título da página: "Música - Artista - Site"
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const fullTitle = tm ? stripTags(tm[1]).trim() : ''
  const parts = fullTitle.split(/\s+[-–|]\s+/)
  const title = (parts[0] ?? '').trim()
  const artist = (parts[1] ?? '').replace(/cifra(s)?( club)?/i, '').trim()

  // melhor <pre> da página (formato universal de cifra)
  let best = ''
  const preRe = /<pre[\s\S]*?<\/pre>/gi
  let m: RegExpExecArray | null
  while ((m = preRe.exec(html)) !== null) {
    const text = stripTags(m[0]).replace(/^\s*\n/, '')
    if (text.length > best.length) best = text
  }

  let weak = false
  if (best.trim().length < 120) {
    weak = true
    const bodyM = /<body[\s\S]*?<\/body>/i.exec(html)
    const cleaned = (bodyM ? bodyM[0] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    best = stripTags(cleaned).replace(/\n{3,}/g, '\n\n').trim().slice(0, 20_000)
  }

  // tom anunciado pela página (Cifra Club e similares), quando existir
  const tomM =
    /"tom"\s*:\s*"([A-G][#b]?m?)"/i.exec(html) ??
    /id="cifra_tom"[\s\S]{0,160}?>([A-G][#b]?m?)</.exec(html) ??
    /[Tt]om:?\s*<[^>]*>\s*([A-G][#b]?m?)\s*</.exec(html)
  const tom = tomM ? tomM[1] : null

  return { title, artist, tom, body: best.trimEnd() + '\n', sourceUrl: finalUrl, host: hostOf(finalUrl), weak }
}

// ---------- servidor ----------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  // sem Origin conhecida também é recusa: quem chama de fora do navegador não
  // manda nenhuma, e era por aí que passava o proxy anônimo
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'GET') return json({ error: 'somente GET' }, 405, origin)

  // Portaria: o crachá da PESSOA, não a chave pública do app
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  let quem: string | null
  try {
    quem = await quemE(token)
  } catch {
    return json({ error: 'não deu para conferir sua conta agora' }, 502, origin)
  }
  if (!quem) return json({ error: 'entre na sua conta primeiro' }, 401, origin)

  const url = new URL(req.url)
  const op = url.searchParams.get('op') ?? ''

  try {
    if (op === 'search') {
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120)
      if (q.length < 2) return json({ error: 'busca vazia' }, 400, origin)
      // 1º: sugestões do próprio Cifra Club; 2º e 3º: motores de busca gerais
      let hits = rankHits(await searchCifraClubSuggest(q))
      if (hits.length === 0) {
        const query = /cifra/i.test(q) ? q : q + ' cifra'
        hits = rankHits(await searchDuckDuckGo(query))
        if (hits.length === 0) hits = rankHits(await searchBing(query))
      }
      return json({ hits }, 200, origin)
    }

    if (op === 'fetch') {
      const target = url.searchParams.get('url') ?? ''
      if (!isPublicHttpUrl(target)) return json({ error: 'endereço inválido' }, 400, origin)
      const { finalUrl, html } = await fetchPage(target)
      return json(extractCifra(html, finalUrl), 200, origin)
    }

    return json({ error: 'use op=search ou op=fetch' }, 400, origin)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }
})
