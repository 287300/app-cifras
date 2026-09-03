// Sincronização entre aparelhos do App de Cifras.
//
// O app cifra as músicas NO APARELHO com um segredo sorteado lá; aqui só
// chegam blobs ilegíveis. Uma linha por segredo (id = hash dele).
//
//   POST {op:'pull', id}                                → {empty} ou {payload, updatedAt, device}
//   POST {op:'push', id, payload, device, baseUpdatedAt} → {ok, updatedAt} ou 409 {conflict, ...}
//   POST {op:'pair-create', pairId, payload}            → {ok}   (vale 10 minutos)
//   POST {op:'pair-claim', pairId}                      → {payload} e apaga (uso único)
//
// baseUpdatedAt é a versão da nuvem que o aparelho viu por último: se a nuvem
// mudou nesse meio tempo, devolvemos 409 com o conteúdo atual e o aparelho
// mescla localmente e tenta de novo (o merge é sempre no aparelho).
//
// TODAS as operações exigem crachá válido e assinatura em dia (ticket 17).
// Três coisas que valem explicação:
//
// 1. O crachá é conferido AQUI, chamando o servidor de contas. A função exige
//    um JWT válido para ser chamada, mas a chave pública do app também é um
//    JWT válido: ela abre a porta, não diz quem entrou.
//
// 2. A CONTA NÃO É A CHAVE. Ela decide quem pode gravar e ler; o conteúdo
//    continua cifrado com um segredo que só existe nos aparelhos. Este código
//    nunca vê música, observação nem nome de show, e continua sem ver depois
//    desta mudança.
//
// 3. Recusa por assinatura é 402, separada do 401 de crachá. São dois
//    problemas com duas soluções diferentes, e o app precisa saber qual é
//    para dizer a frase certa em vez de mostrar um erro.

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

const MAX_PAYLOAD = 2_000_000

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
const REST = BASE + '/rest/v1/sync_backups'
const HEADERS = {
  apikey: SERVICE,
  Authorization: 'Bearer ' + SERVICE,
  'Content-Type': 'application/json',
}

interface Row {
  id: string
  payload: string
  device: string
  updated_at: string
  dono?: string | null
}

/** O servidor de contas está fora do ar, e não a pessoa sem crachá. */
class ContasForaDoAr extends Error {}

/**
 * Quem é o dono deste crachá, segundo o servidor de contas. Null se não vale.
 *
 * A separação entre "crachá ruim" e "servidor de contas fora do ar" não é
 * detalhe: tratar as duas coisas como 401 fazia o app dizer "é preciso entrar
 * com o seu e-mail" logo abaixo do cartão que dizia "Entrando como fulano".
 * Dois cartões se contradizendo na mesma tela, para quem não usa tecnologia.
 */
async function quemE(token: string): Promise<string | null> {
  if (!token) return null
  const res = await fetch(BASE + '/auth/v1/user', {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + token },
  })
  if (res.status >= 500) throw new ContasForaDoAr('servidor de contas fora do ar')
  if (!res.ok) return null
  const u = (await res.json()) as { email?: string }
  const email = (u.email ?? '').trim().toLowerCase()
  return email || null
}

/** Esta pessoa está com a assinatura em dia agora? */
async function estaPagando(email: string): Promise<boolean> {
  const url = `${BASE}/rest/v1/assinaturas?email=eq.${encodeURIComponent(email)}&select=plano,valida_ate`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error('banco respondeu ' + res.status)
  const linhas = (await res.json()) as Array<{ plano: string; valida_ate: string | null }>
  const linha = linhas[0]
  if (!linha || linha.plano !== 'pago') return false
  // sem tolerância aqui: o servidor está vendo a verdade. A tolerância de dias
  // offline é do aparelho, e só existe porque lá falta internet, não certeza
  return linha.valida_ate ? Date.parse(linha.valida_ate) > Date.now() : false
}

async function getRow(id: string): Promise<Row | null> {
  const res = await fetch(`${REST}?id=eq.${id}&select=id,payload,device,updated_at,dono`, { headers: HEADERS })
  if (!res.ok) throw new Error('banco respondeu ' + res.status)
  const rows = (await res.json()) as Row[]
  return rows[0] ?? null
}

/**
 * Esta linha é desta pessoa?
 *
 * Linha sem dono é linha de antes desta regra: adota quem chegou primeiro, e a
 * partir daí ela tem dono. Linha com outro dono não existe para quem pergunta:
 * responder "essa é de outra pessoa" já entregaria que o id acertou em alguém.
 */
function daPessoa(row: { dono?: string | null } | null, email: string): boolean {
  if (!row) return true
  return !row.dono || row.dono === email
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'POST') return json({ error: 'somente POST' }, 405, origin)

  let body: { op?: string; id?: string; pairId?: string; payload?: string; device?: string; baseUpdatedAt?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'corpo inválido' }, 400, origin)
  }

  // Portaria única, antes de qualquer operação: sem crachá válido e assinatura
  // em dia, a nuvem não grava nem devolve nada. Vale igual para pull, push e
  // para os dois lados do código de 6 números.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  let email: string | null
  try {
    email = await quemE(token)
  } catch {
    // 502 e não 401: problema nosso nunca pode virar "entre na sua conta" para
    // quem já está dentro
    return json({ error: 'não deu para conferir sua conta agora' }, 502, origin)
  }
  if (!email) return json({ error: 'entre na sua conta primeiro' }, 401, origin)
  try {
    if (!(await estaPagando(email))) {
      return json({ error: 'sincronizar entre aparelhos é recurso da assinatura' }, 402, origin)
    }
  } catch (e) {
    // banco fora do ar não é assinatura vencida: quem paga não pode ver
    // "assine" por causa de um problema nosso
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }

  const PAIR = BASE + '/rest/v1/pair_codes'
  const PAIR_TTL_MIN = 10

  // ---------- pareamento por código de 6 dígitos ----------
  if (body.op === 'pair-create' || body.op === 'pair-claim') {
    const pairId = body.pairId ?? ''
    if (!/^[0-9a-f]{64}$/.test(pairId)) return json({ error: 'código inválido' }, 400, origin)
    const limite = new Date(Date.now() - PAIR_TTL_MIN * 60_000).toISOString()
    try {
      // limpeza dos códigos vencidos a cada chamada
      await fetch(`${PAIR}?created_at=lt.${limite}`, { method: 'DELETE', headers: HEADERS })

      if (body.op === 'pair-create') {
        const payload = body.payload ?? ''
        if (!payload || payload.length > 20_000) return json({ error: 'payload inválido' }, 400, origin)
        // o código pendente de outra pessoa não pode ser sobrescrito: seria
        // plantar um conjunto no aparelho novo dela
        const jaLa = await fetch(`${PAIR}?id=eq.${pairId}&select=dono`, { headers: HEADERS })
        if (!jaLa.ok) throw new Error('banco respondeu ' + jaLa.status)
        const antes = (await jaLa.json()) as Array<{ dono?: string | null }>
        if (!daPessoa(antes[0] ?? null, email)) {
          return json({ error: 'código em uso, peça outro no aparelho antigo' }, 409, origin)
        }
        const res = await fetch(PAIR, {
          method: 'POST',
          headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([{ id: pairId, payload, dono: email, created_at: new Date().toISOString() }]),
        })
        if (!res.ok) throw new Error('banco respondeu ' + res.status)
        return json({ ok: true, expiresInMin: PAIR_TTL_MIN }, 200, origin)
      }

      const res = await fetch(`${PAIR}?id=eq.${pairId}&select=payload,created_at,dono`, { headers: HEADERS })
      if (!res.ok) throw new Error('banco respondeu ' + res.status)
      const rows = (await res.json()) as Array<{ payload: string; created_at: string; dono?: string | null }>
      const row = rows[0]
      // A MESMA RESPOSTA para "não existe" e "é de outra pessoa". São só um
      // milhão de códigos possíveis: se a recusa fosse diferente, varrer todos
      // viraria um mapa de quem está pareando agora
      if (!row || !daPessoa(row, email)) {
        return json({ error: 'código não encontrado ou já usado' }, 404, origin)
      }
      await fetch(`${PAIR}?id=eq.${pairId}`, { method: 'DELETE', headers: HEADERS }) // uso único
      if (Date.parse(row.created_at) < Date.now() - PAIR_TTL_MIN * 60_000) {
        return json({ error: 'código expirado' }, 410, origin)
      }
      return json({ payload: row.payload }, 200, origin)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
    }
  }

  const id = body.id ?? ''
  if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: 'chave inválida' }, 400, origin)

  try {
    if (body.op === 'pull') {
      const row = await getRow(id)
      // linha de outra pessoa responde igual a linha que não existe
      if (!row || !daPessoa(row, email)) return json({ empty: true }, 200, origin)
      return json({ payload: row.payload, updatedAt: Date.parse(row.updated_at), device: row.device }, 200, origin)
    }

    if (body.op === 'push') {
      const payload = body.payload ?? ''
      if (typeof payload !== 'string' || payload.length === 0) return json({ error: 'payload vazio' }, 400, origin)
      if (payload.length > MAX_PAYLOAD) return json({ error: 'backup grande demais' }, 413, origin)
      const device = (body.device ?? '').slice(0, 40)
      const base = typeof body.baseUpdatedAt === 'number' ? body.baseUpdatedAt : 0

      const cur = await getRow(id)
      if (!daPessoa(cur, email)) return json({ error: 'esta cópia é de outra conta' }, 403, origin)
      if (cur && Math.abs(Date.parse(cur.updated_at) - base) > 1500) {
        // a nuvem mudou desde a última vista deste aparelho: devolve para mesclar
        return json(
          { conflict: true, payload: cur.payload, updatedAt: Date.parse(cur.updated_at), device: cur.device },
          409,
          origin
        )
      }

      const now = new Date().toISOString()
      const res = await fetch(REST, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{ id, payload, device, dono: email, updated_at: now }]),
      })
      if (!res.ok) throw new Error('banco respondeu ' + res.status)
      const saved = ((await res.json()) as Row[])[0]
      return json({ ok: true, updatedAt: Date.parse(saved?.updated_at ?? now) }, 200, origin)
    }

    return json({ error: 'use op=pull ou op=push' }, 400, origin)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }
})
