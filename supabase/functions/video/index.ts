// Busca do clipe no YouTube para o modo ensaio do App de Cifras.
//
//   GET ?q=nome da musica artista  →  {hits:[{id, title, channel, length}]}
//
// Só devolve identificadores públicos de vídeo (o mesmo que a busca do
// YouTube mostra); quem toca é o player oficial embutido no app.
//
// EXIGE O CRACHÁ DE UMA PESSOA (revisão de 04/09/2026). A função exige um JWT
// válido para ser chamada, mas a chave pública do app também é um JWT válido, e
// ela mora dentro do app.js, que é um arquivo aberto na internet. E o CORS não
// é portão: quem chama de fora do navegador não manda cabeçalho Origin nenhum.
// Sem conferir QUEM está pedindo, isto era um raspador do YouTube aberto,
// rodando na conta e na fatura do Eder.

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

const BASE = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HEADERS = {
  apikey: SERVICE,
  Authorization: 'Bearer ' + SERVICE,
  'Content-Type': 'application/json',
}

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

/** Teto de leitura da página do YouTube (achado S10 da auditoria de 04/09). */
const MAX_BYTES = 600_000

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


/** Nome desta função nas chaves de contagem do freio. */
const FUNCAO = 'video'
/** Tetos do freio: por conta e por endereço, no minuto e no dia. */
const TETO_CONTA = { minuto: 20, dia: 200 }
const TETO_ENDERECO = { minuto: 40, dia: 400 }

// <<< freio-de-mao
// O FREIO DE MÃO (achado S4 da auditoria de 04/09/2026).
//
// Nenhuma das quatro funções tinha limite próprio. A chave pública do app está
// publicada dentro do `app.js`, que é um arquivo aberto na internet, e com ela
// um laço de duas linhas gera invocação, tráfego e chamada ao servidor de
// contas sem nada freando. A conta é paga, e quem paga é o Eder.
//
// Duas contagens, porque elas resolvem problemas diferentes:
//
//   - POR MINUTO barra a rajada, que é o formato de um laço;
//   - POR DIA barra o gotejamento, que é o formato de quem lê o limite por
//     minuto e resolve ficar logo abaixo dele o dia inteiro.
//
// E duas chaves: por ENDEREÇO, conferida antes de qualquer trabalho, para uma
// enxurrada anônima não queimar nem a chamada ao servidor de contas; e por
// CONTA, depois de saber quem é, porque endereço se troca e conta não.
//
// FALHA ABERTA, de propósito. Se o banco não responder, o pedido passa. Um
// problema nosso não pode virar "muitos pedidos" na cara de quem está pagando e
// só quer abrir o show. O freio protege a fatura; ele não é a tranca da porta,
// que é o crachá.
const FREIO_URL = BASE + '/rest/v1/rpc/registra_uso'

/** De qual endereço veio o pedido, para efeito de contagem. */
function deOndeVeio(req: Request): string {
  const cadeia = req.headers.get('x-forwarded-for') ?? ''
  const primeiro = (cadeia.split(',')[0] ?? '').trim()
  return primeiro || 'sem-endereco'
}

/**
 * Conta este pedido e diz se ele passou de algum dos dois tetos.
 *
 * O balde de tempo entra na própria chave, então cada janela nova é uma chave
 * nova: nada precisa ser zerado e não há relógio para acertar.
 */
async function passouDoTeto(quem: string, porMinuto: number, porDia: number): Promise<boolean> {
  const agora = Date.now()
  const minuto = `${FUNCAO}:m:${quem}:${Math.floor(agora / 60_000)}`
  const dia = `${FUNCAO}:d:${quem}:${Math.floor(agora / 86_400_000)}`
  try {
    const res = await fetch(FREIO_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ p_chave_minuto: minuto, p_chave_dia: dia }),
    })
    if (!res.ok) return false
    const conta = (await res.json()) as number[] | null
    const noMinuto = conta?.[0] ?? 0
    const noDia = conta?.[1] ?? 0
    return noMinuto > porMinuto || noDia > porDia
  } catch {
    return false
  }
}

/** A recusa do freio, em português e sem número de erro. */
function freado(origin: string): Response {
  return json({ error: 'Muitos pedidos seguidos. Espere um minuto e tente de novo.' }, 429, origin)
}
// >>> freio-de-mao
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'GET') return json({ error: 'somente GET' }, 405, origin)

  // freio pelo endereço antes da chamada ao servidor de contas, e pela conta
  // logo depois de saber quem é
  if (await passouDoTeto(deOndeVeio(req), TETO_ENDERECO.minuto, TETO_ENDERECO.dia)) return freado(origin)

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  let quem: string | null
  try {
    quem = await quemE(token)
  } catch {
    return json({ error: 'não deu para conferir sua conta agora' }, 502, origin)
  }
  if (!quem) return json({ error: 'entre na sua conta primeiro' }, 401, origin)

  if (await passouDoTeto('conta:' + quem, TETO_CONTA.minuto, TETO_CONTA.dia)) return freado(origin)

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
      html = await textoLimitado(res, MAX_BYTES)
    } finally {
      clearTimeout(timer)
    }
    return json({ hits: extractHits(html) }, 200, origin)
  } catch (e) {
    // mesmo motivo do S9 na cifra: nem número, nem nome de serviço de fora
    console.error('video:', e instanceof Error ? e.message : e)
    return json({ error: 'Não deu para buscar o vídeo agora. Tente de novo em alguns minutos.' }, 502, origin)
  }
})
