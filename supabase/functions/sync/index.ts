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

const ALLOWED_ORIGINS = new Set([
  'https://287300.github.io',
  'https://cifrasdoeder.com.br',
  'https://www.cifrasdoeder.com.br',
  'http://localhost:8080',
  'http://localhost:8123',
  'http://localhost:8129',
])

const MAX_PAYLOAD = 2_000_000

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://287300.github.io',
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
}

async function getRow(id: string): Promise<Row | null> {
  const res = await fetch(`${REST}?id=eq.${id}&select=id,payload,device,updated_at`, { headers: HEADERS })
  if (!res.ok) throw new Error('banco respondeu ' + res.status)
  const rows = (await res.json()) as Row[]
  return rows[0] ?? null
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
        const res = await fetch(PAIR, {
          method: 'POST',
          headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([{ id: pairId, payload, created_at: new Date().toISOString() }]),
        })
        if (!res.ok) throw new Error('banco respondeu ' + res.status)
        return json({ ok: true, expiresInMin: PAIR_TTL_MIN }, 200, origin)
      }

      const res = await fetch(`${PAIR}?id=eq.${pairId}&select=payload,created_at`, { headers: HEADERS })
      if (!res.ok) throw new Error('banco respondeu ' + res.status)
      const rows = (await res.json()) as Array<{ payload: string; created_at: string }>
      const row = rows[0]
      if (!row) return json({ error: 'código não encontrado ou já usado' }, 404, origin)
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
      if (!row) return json({ empty: true }, 200, origin)
      return json({ payload: row.payload, updatedAt: Date.parse(row.updated_at), device: row.device }, 200, origin)
    }

    if (body.op === 'push') {
      const payload = body.payload ?? ''
      if (typeof payload !== 'string' || payload.length === 0) return json({ error: 'payload vazio' }, 400, origin)
      if (payload.length > MAX_PAYLOAD) return json({ error: 'backup grande demais' }, 413, origin)
      const device = (body.device ?? '').slice(0, 40)
      const base = typeof body.baseUpdatedAt === 'number' ? body.baseUpdatedAt : 0

      const cur = await getRow(id)
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
        body: JSON.stringify([{ id, payload, device, updated_at: now }]),
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
