// A plataforma de recebimento, de mentira, para poder testar antes de ela existir.
//
// Ela fala exatamente o contrato do ticket 25, e nada além dele. É por isso que
// serve: no dia em que a plataforma de verdade subir, o que muda no Cifra Pronta
// são duas variáveis de ambiente, e nem uma linha de código.
//
// Analogia: é a maquininha de brinquedo que a loja usa para ensaiar o caixa. O
// dinheiro não existe, mas o beep, o papel e a ordem dos passos são os mesmos.
//
// Rodar com:
//   bun run scripts/simulador-pagamento.ts --webhook=http://localhost:54321/functions/v1/pagamento/webhook
//
// Opções:
//   --porta=8130          onde ele escuta
//   --webhook=URL         para onde manda o aviso quando a cobrança é paga
//   --segredo=...         o mesmo WEBHOOK_SEGREDO da função de borda
//   --chave=...           a chave que ele exige no Authorization das cobranças
//   --auto=8              paga sozinho depois de N segundos (0 desliga)
//
// Sem --webhook ele só cria cobranças, o que já serve para ver a tela.

import { createHmac, randomUUID } from 'node:crypto'

function opcao(nome: string, padrao: string): string {
  const achou = process.argv.find((a) => a.startsWith('--' + nome + '='))
  return achou ? achou.slice(nome.length + 3) : padrao
}

const PORTA = Number(opcao('porta', '8130'))
const WEBHOOK = opcao('webhook', '')
const SEGREDO = opcao('segredo', 'segredo-de-ensaio')
const CHAVE = opcao('chave', 'chave-de-ensaio')
const AUTO_SEGUNDOS = Number(opcao('auto', '0'))

/** PNG de 1 pixel: aqui o QR é enfeite, o que se testa é o caminho até a tela. */
const QR_DE_MENTIRA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

interface Cobranca {
  id: string
  produto: string
  email: string
  valorCentavos: number
  expiraEm: string
  paga: boolean
}

const cobrancas = new Map<string, Cobranca>()

/**
 * Um código Pix copia-e-cola com a cara do de verdade (formato EMV, campos
 * numerados, CRC no fim). Não é válido em banco nenhum, e nem deve ser.
 */
function copiaECola(id: string, centavos: number): string {
  const valor = (centavos / 100).toFixed(2)
  const corpo = `00020126580014BR.GOV.BCB.PIX0136${id.padEnd(36, '0').slice(0, 36)}5204000053039865802BR5913CIFRA PRONTA6009SAO PAULO54${String(valor.length).padStart(2, '0')}${valor}62070503***6304`
  let crc = 0xffff
  for (const ch of corpo) {
    crc ^= ch.charCodeAt(0) << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return corpo + crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Manda o aviso assinado, do mesmo jeito que a plataforma de verdade mandará. */
async function avisa(cobranca: Cobranca, evento: string): Promise<string> {
  if (!WEBHOOK) return 'sem --webhook: nada foi avisado'
  const corpo = JSON.stringify({
    evento,
    produto: cobranca.produto,
    email: cobranca.email,
    externoId: cobranca.id,
    ocorridoEm: new Date().toISOString(),
  })
  const carimbo = String(Math.floor(Date.now() / 1000))
  const assinatura = createHmac('sha256', SEGREDO).update(carimbo + '.' + corpo).digest('hex')
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cp-Carimbo': carimbo,
        'X-Cp-Assinatura': 'sha256=' + assinatura,
      },
      body: corpo,
    })
    const texto = (await res.text()).slice(0, 200)
    console.log(`  aviso ${evento} de ${cobranca.id} -> ${res.status} ${texto}`)
    return `${res.status} ${texto}`
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'falhou'
    console.log(`  aviso ${evento} de ${cobranca.id} -> ERRO ${erro}`)
    return 'erro: ' + erro
  }
}

function pagina(): string {
  const linhas = [...cobrancas.values()]
    .reverse()
    .map(
      (c) =>
        `<tr><td>${c.email}</td><td>${c.id}</td><td>R$ ${(c.valorCentavos / 100).toFixed(2)}</td>` +
        `<td>${c.paga ? '✅ paga' : '⏳ esperando'}</td>` +
        `<td>${c.paga ? '' : `<form method="post" action="/pagar"><input type="hidden" name="id" value="${c.id}"><button>Pagar</button></form>`}</td></tr>`
    )
    .join('')
  return `<!doctype html><meta charset="utf-8"><title>Simulador de recebimento</title>
<style>body{font:15px system-ui;margin:24px;max-width:900px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}button{padding:6px 12px}</style>
<h1>Simulador de recebimento</h1>
<p>Webhook: <code>${WEBHOOK || '(nenhum)'}</code> &middot; pagamento automático: <code>${AUTO_SEGUNDOS || 'desligado'}</code></p>
<table><tr><th>E-mail</th><th>Cobrança</th><th>Valor</th><th>Estado</th><th></th></tr>${linhas || '<tr><td colspan="5">nenhuma cobrança ainda</td></tr>'}</table>`
}

async function paga(id: string): Promise<string> {
  const c = cobrancas.get(id)
  if (!c) return 'cobrança desconhecida'
  if (c.paga) return 'já estava paga'
  c.paga = true
  return await avisa(c, 'compra')
}

Bun.serve({
  port: PORTA,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(pagina(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // cria a cobrança: é este endpoint que a função de borda chama
    if (req.method === 'POST' && url.pathname === '/v1/cobrancas') {
      const chave = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      if (chave !== CHAVE) return new Response('chave do produto não confere', { status: 401 })

      const p = (await req.json()) as { produto?: string; email?: string; valor_centavos?: number; expira_em_segundos?: number }
      if (!p.produto || !p.email || !p.valor_centavos) return new Response('faltam campos', { status: 400 })

      const id = 'cob_' + randomUUID().replace(/-/g, '').slice(0, 20)
      const c: Cobranca = {
        id,
        produto: p.produto,
        email: p.email.toLowerCase(),
        valorCentavos: p.valor_centavos,
        expiraEm: new Date(Date.now() + (p.expira_em_segundos ?? 900) * 1000).toISOString(),
        paga: false,
      }
      cobrancas.set(id, c)
      console.log(`cobrança ${id} para ${c.email}, R$ ${(c.valorCentavos / 100).toFixed(2)}`)
      if (AUTO_SEGUNDOS > 0) setTimeout(() => void paga(id), AUTO_SEGUNDOS * 1000)

      return Response.json(
        { id, copia_e_cola: copiaECola(id, c.valorCentavos), qr_png_base64: QR_DE_MENTIRA, expira_em: c.expiraEm },
        { status: 201 }
      )
    }

    // paga na mão: pelo botão da página ou por POST /pagar {"id":"..."}
    if (req.method === 'POST' && url.pathname === '/pagar') {
      const tipo = req.headers.get('content-type') ?? ''
      const id = tipo.includes('json') ? ((await req.json()) as { id?: string }).id ?? '' : String((await req.formData()).get('id') ?? '')
      const r = await paga(id)
      if (tipo.includes('json')) return Response.json({ resultado: r })
      return new Response(null, { status: 303, headers: { Location: '/' } })
    }

    // reembolso, cancelamento e os outros avisos, para ensaiar o caminho triste
    if (req.method === 'POST' && url.pathname === '/evento') {
      const { id, evento } = (await req.json()) as { id?: string; evento?: string }
      const c = cobrancas.get(id ?? '')
      if (!c) return new Response('cobrança desconhecida', { status: 404 })
      return Response.json({ resultado: await avisa(c, evento ?? 'renovacao') })
    }

    return new Response('não existe', { status: 404 })
  },
})

console.log(`simulador de recebimento em http://localhost:${PORTA}`)
console.log(`  webhook: ${WEBHOOK || '(nenhum: as cobranças só ficam esperando)'}`)
console.log(`  chave do produto: ${CHAVE}`)
