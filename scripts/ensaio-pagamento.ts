// Ensaio geral da cobrança, do pedido do QR até a licença virar paga.
//
// Roda a FUNÇÃO DE BORDA DE VERDADE, o arquivo que vai para o Supabase, sem
// copiar nem reescrever nada dela. O que é de mentira em volta é só o mundo:
// um Supabase de brinquedo (contas e tabelas em memória) e a plataforma de
// recebimento simulada. É o mesmo princípio do ensaio de um show: os músicos
// são os de verdade, o palco é o da casa, e só o público não veio.
//
// Rodar com:
//   bun run scripts/simulador-pagamento.ts --webhook=http://localhost:8132/pagamento/webhook --auto=2 &
//   bun run scripts/ensaio-pagamento.ts
//
// Sai com código 1 se qualquer passo falhar, então serve em automação.

import { createHmac } from 'node:crypto'

const PORTA_SUPABASE = 8131
const PORTA_BORDA = 8132
const PLATAFORMA = 'http://localhost:8130'
const SEGREDO = 'segredo-de-ensaio'
const CHAVE = 'chave-de-ensaio'
const CRACHA = 'cracha-do-musico'
const EMAIL = 'musico@exemplo.com'
const ORIGEM_BOA = 'https://cifrapronta.com.br'

// ---------- o Supabase de brinquedo ----------

interface Linha {
  email: string
  plano: string
  valida_ate: string | null
  renova: boolean
}
const assinaturas = new Map<string, Linha>()
const eventos: Record<string, unknown>[] = []
const DINHEIRO = new Set(['compra', 'renovacao', 'atraso', 'cancelamento', 'reembolso'])

function filtro(url: URL, campo: string): string {
  const v = url.searchParams.get(campo) ?? ''
  return v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : ''
}

const supabase = Bun.serve({
  port: PORTA_SUPABASE,
  async fetch(req) {
    const url = new URL(req.url)

    // o servidor de contas: só o crachá combinado vale
    if (url.pathname === '/auth/v1/user') {
      const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      if (token !== CRACHA) return new Response('sem crachá', { status: 401 })
      return Response.json({ email: EMAIL })
    }

    if (url.pathname === '/rest/v1/assinaturas') {
      if (req.method === 'GET') {
        const linha = assinaturas.get(filtro(url, 'email'))
        return Response.json(linha ? [linha] : [])
      }
      const p = (await req.json()) as Record<string, unknown>
      const email = String(p.email)
      assinaturas.set(email, {
        email,
        plano: String(p.plano),
        valida_ate: (p.valida_ate as string | null) ?? null,
        renova: p.renova !== false,
      })
      return new Response(null, { status: 201 })
    }

    if (url.pathname === '/rest/v1/eventos_pagamento') {
      if (req.method === 'GET') {
        const email = filtro(url, 'email')
        const evento = filtro(url, 'evento')
        const achados = eventos.filter((e) => e.email === email && e.evento === evento).reverse()
        return Response.json(achados.slice(0, 1))
      }
      const p = (await req.json()) as Record<string, unknown>
      // o índice único do banco, de brinquedo mas com a mesma regra
      if (
        DINHEIRO.has(String(p.evento)) &&
        eventos.some((e) => e.origem === p.origem && e.externo_id === p.externo_id && e.evento === p.evento)
      ) {
        return new Response('duplicate key', { status: 409 })
      }
      eventos.push(p)
      return new Response(null, { status: 201 })
    }

    return new Response('não existe: ' + url.pathname, { status: 404 })
  },
})

// ---------- a função de borda de verdade ----------

const ambiente: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:' + PORTA_SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico-de-ensaio',
  PLATAFORMA_URL: PLATAFORMA,
  PLATAFORMA_CHAVE: CHAVE,
  WEBHOOK_SEGREDO: SEGREDO,
}

let handler: ((req: Request) => Promise<Response>) | null = null
// o Deno que a função espera encontrar: só as duas coisas que ela usa
;(globalThis as unknown as Record<string, unknown>).Deno = {
  env: { get: (chave: string) => ambiente[chave] },
  serve: (fn: (req: Request) => Promise<Response>) => {
    handler = fn
  },
}

const caminho = new URL('../supabase/functions/pagamento/index.ts', import.meta.url).pathname
await import(caminho)
if (!handler) throw new Error('a função de borda não registrou o atendimento')
const atende = handler as (req: Request) => Promise<Response>

const borda = Bun.serve({ port: PORTA_BORDA, fetch: (req) => atende(req) })

// ---------- os passos do ensaio ----------

let falhas = 0
function confere(titulo: string, condicao: boolean, detalhe = ''): void {
  console.log(`${condicao ? '  ok  ' : '  FALHOU  '} ${titulo}${detalhe && !condicao ? ' — ' + detalhe : ''}`)
  if (!condicao) falhas++
}

function chamaCobrar(headers: Record<string, string>): Promise<Response> {
  return atende(
    new Request('http://localhost/pagamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ op: 'cobrar' }),
    })
  )
}

function mandaAviso(corpo: Record<string, unknown>, opcoes: { carimbo?: number; segredo?: string } = {}): Promise<Response> {
  const texto = JSON.stringify(corpo)
  const carimbo = String(opcoes.carimbo ?? Math.floor(Date.now() / 1000))
  const assinatura = createHmac('sha256', opcoes.segredo ?? SEGREDO).update(carimbo + '.' + texto).digest('hex')
  return atende(
    new Request('http://localhost/pagamento/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cp-Carimbo': carimbo,
        'X-Cp-Assinatura': 'sha256=' + assinatura,
      },
      body: texto,
    })
  )
}

const aviso = (extra: Record<string, unknown> = {}) => ({
  evento: 'compra',
  produto: 'cifra-pronta',
  email: EMAIL,
  externoId: 'cob_ensaio_1',
  ocorridoEm: new Date().toISOString(),
  ...extra,
})

console.log('\n== a porta do app ==')
{
  const semOrigem = await chamaCobrar({ Authorization: 'Bearer ' + CRACHA })
  confere('sem cabeçalho de origem, 403', semOrigem.status === 403, 'veio ' + semOrigem.status)

  const outraOrigem = await chamaCobrar({ Origin: 'https://site-do-golpe.com', Authorization: 'Bearer ' + CRACHA })
  confere('origem estranha, 403', outraOrigem.status === 403, 'veio ' + outraOrigem.status)

  const semCracha = await chamaCobrar({ Origin: ORIGEM_BOA })
  confere('sem crachá, 401', semCracha.status === 401, 'veio ' + semCracha.status)
}

console.log('\n== gerar o Pix ==')
let idDaCobranca = ''
{
  let plataformaViva = true
  try {
    await fetch(PLATAFORMA + '/', { signal: AbortSignal.timeout(1500) })
  } catch {
    plataformaViva = false
  }
  if (!plataformaViva) {
    console.log('  (simulador fora do ar em ' + PLATAFORMA + ': rode-o antes para valer este trecho)')
    falhas++
  } else {
    const res = await chamaCobrar({ Origin: ORIGEM_BOA, Authorization: 'Bearer ' + CRACHA })
    const d = (await res.json()) as Record<string, unknown>
    confere('com crachá e origem certa, 200', res.status === 200, 'veio ' + res.status + ' ' + JSON.stringify(d))
    confere('veio o código copia e cola', typeof d.copiaECola === 'string' && String(d.copiaECola).startsWith('000201'))
    confere('veio o QR', typeof d.qrPngBase64 === 'string' && String(d.qrPngBase64).length > 50)
    confere('o e-mail é o do crachá, não o que o app mandar', d.email === EMAIL)
    idDaCobranca = String(d.id ?? '')

    const denovo = await chamaCobrar({ Origin: ORIGEM_BOA, Authorization: 'Bearer ' + CRACHA })
    const d2 = (await denovo.json()) as Record<string, unknown>
    confere('pedir de novo reaproveita a mesma cobrança', d2.id === idDaCobranca && d2.reaproveitada === true)
  }
}

console.log('\n== o webhook ==')
{
  const semAssinatura = await atende(
    new Request('http://localhost/pagamento/webhook', { method: 'POST', body: JSON.stringify(aviso()) })
  )
  confere('sem assinatura, 401', semAssinatura.status === 401, 'veio ' + semAssinatura.status)

  const assinaturaErrada = await mandaAviso(aviso(), { segredo: 'outro-segredo' })
  confere('assinatura de outro segredo, 401', assinaturaErrada.status === 401, 'veio ' + assinaturaErrada.status)

  const velho = await mandaAviso(aviso(), { carimbo: Math.floor(Date.now() / 1000) - 600 })
  confere('carimbo de 10 minutos atrás, 401', velho.status === 401, 'veio ' + velho.status)

  const outroProduto = await mandaAviso(aviso({ produto: 'outro-app' }))
  confere('aviso de outro produto, 400', outroProduto.status === 400, 'veio ' + outroProduto.status)

  const eventoInventado = await mandaAviso(aviso({ evento: 'liberar-tudo' }))
  confere('evento inventado, 400', eventoInventado.status === 400, 'veio ' + eventoInventado.status)

  confere('nada disso virou assinatura', assinaturas.get(EMAIL) === undefined)
}

console.log('\n== a compra que vale ==')
{
  const compra = await mandaAviso(aviso())
  confere('compra aceita, 200', compra.status === 200, 'veio ' + compra.status)

  const linha = assinaturas.get(EMAIL)
  confere('a licença virou paga', linha?.plano === 'pago', JSON.stringify(linha))
  const dias = linha?.valida_ate ? Math.round((Date.parse(linha.valida_ate) - Date.now()) / 86_400_000) : 0
  confere('o período é de 31 dias', dias === 31, dias + ' dias')

  const repetido = await mandaAviso(aviso())
  const corpo = (await repetido.json()) as Record<string, unknown>
  confere('a reentrega responde 200', repetido.status === 200, 'veio ' + repetido.status)
  confere('e diz que era repetida', corpo.repetido === true)
  const depois = assinaturas.get(EMAIL)
  confere('a reentrega NÃO deu um segundo mês', depois?.valida_ate === linha?.valida_ate)
}

console.log('\n== o caminho triste ==')
{
  const cancelou = await mandaAviso(aviso({ evento: 'cancelamento', externoId: 'cob_ensaio_1' }))
  confere('cancelamento aceito', cancelou.status === 200, 'veio ' + cancelou.status)
  confere('cancelou mas continua pago até o fim', assinaturas.get(EMAIL)?.plano === 'pago')
  confere('e marcado para não renovar', assinaturas.get(EMAIL)?.renova === false)

  const reembolsou = await mandaAviso(aviso({ evento: 'reembolso', externoId: 'cob_ensaio_1' }))
  confere('reembolso aceito', reembolsou.status === 200, 'veio ' + reembolsou.status)
  confere('reembolso derruba o pago na hora', assinaturas.get(EMAIL)?.plano === 'gratis')
  confere('e zera o prazo', assinaturas.get(EMAIL)?.valida_ate === null)
}

console.log('\n== pelo caminho de rede, do jeito que vai acontecer ==')
{
  // aqui nada é chamado na mão: o simulador assina e bate na porta HTTP da
  // função, exatamente como a plataforma de verdade fará
  if (!idDaCobranca) {
    console.log('  (sem cobrança do simulador: trecho pulado)')
  } else {
    await fetch(PLATAFORMA + '/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idDaCobranca }),
    })
    let virou = false
    for (let i = 0; i < 20 && !virou; i++) {
      await new Promise((r) => setTimeout(r, 250))
      virou = assinaturas.get(EMAIL)?.plano === 'pago'
    }
    confere('o Pix pago pelo simulador liberou a licença sozinho', virou, JSON.stringify(assinaturas.get(EMAIL)))
  }
}

console.log(`\n${falhas === 0 ? '✅ ensaio limpo' : '❌ ' + falhas + ' passo(s) falharam'}\n`)
borda.stop()
supabase.stop()
process.exit(falhas === 0 ? 0 : 1)
