// A licença do App de Cifras: o servidor responde se aquela pessoa paga.
//
//   POST {op:'consultar'}  com o crachá da pessoa no cabeçalho Authorization
//   → {plano, restamMs, renova}
//
// Duas escolhas que valem explicação:
//
// 1. O crachá é conferido AQUI, chamando o próprio servidor de contas. A
//    função exige um JWT válido para ser chamada, mas a chave pública do app
//    também é um JWT válido: ela abre a porta, não diz quem entrou. Sem esta
//    conferência, qualquer pessoa perguntaria pela assinatura de qualquer
//    e-mail.
//
// 2. A resposta vem em TEMPO QUE FALTA (restamMs), não em data de vencimento.
//    Assim o aparelho faz todas as contas com o relógio dele, e um iPad com a
//    data errada não vira uma licença errada.

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

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://cifrapronta.com.br',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

interface Assinatura {
  email: string
  plano: string
  valida_ate: string | null
  renova: boolean
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

async function assinaturaDe(email: string): Promise<Assinatura | null> {
  const url = `${BASE}/rest/v1/assinaturas?email=eq.${encodeURIComponent(email)}&select=email,plano,valida_ate,renova`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error('banco respondeu ' + res.status)
  const linhas = (await res.json()) as Assinatura[]
  return linhas[0] ?? null
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'POST') return json({ error: 'somente POST' }, 405, origin)

  let body: { op?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  if (body.op && body.op !== 'consultar') return json({ error: 'use op=consultar' }, 400, origin)

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

  try {
    const email = await quemE(token)
    if (!email) return json({ error: 'entre na sua conta primeiro' }, 401, origin)

    const linha = await assinaturaDe(email)
    if (!linha || linha.plano !== 'pago') {
      return json({ plano: 'gratis', restamMs: 0, renova: true }, 200, origin)
    }
    const fim = linha.valida_ate ? Date.parse(linha.valida_ate) : 0
    const restamMs = Math.max(0, fim - Date.now())
    // prazo esgotado no servidor é grátis agora, sem tolerância nenhuma: aqui
    // não existe "pode ser que tenha renovado", o servidor está vendo a verdade
    if (restamMs === 0) return json({ plano: 'gratis', restamMs: 0, renova: linha.renova }, 200, origin)
    return json({ plano: 'pago', restamMs, renova: linha.renova }, 200, origin)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }
})
