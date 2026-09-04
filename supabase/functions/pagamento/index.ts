// A cobrança do Cifra Pronta: pede o Pix e escuta a plataforma avisar que caiu.
//
//   POST /pagamento            {op:'cobrar'}   com o crachá da pessoa
//   → {id, copiaECola, qrPngBase64, expiraEm}
//
//   POST /pagamento/webhook    sem crachá, com assinatura no cabeçalho
//   → {ok:true}
//
// As duas portas são de naturezas opostas e é isso que explica o desenho:
//
// 1. `cobrar` é o app falando. Exige crachá, e o e-mail da cobrança sai do
//    crachá, nunca do corpo: quem paga é quem está logado, e ninguém emite
//    cobrança em nome de outra pessoa.
//
// 2. `/webhook` é a PLATAFORMA falando, e ela não tem crachá nenhum. É a única
//    porta pública do projeto. O que vale ali é a assinatura sobre o corpo
//    bruto: sem ela, qualquer um liberaria assinatura para qualquer e-mail
//    mandando um POST. Por isso ela é conferida ANTES de qualquer coisa, antes
//    até de o corpo virar objeto.
//
// A régua de "o que este evento faz com a licença" NÃO mora aqui. Ela é a
// mesma do app, copiada abaixo entre marcas, e um teste compara as duas cópias.
//
// Segredos, todos por variável de ambiente e nenhum no código:
//   PLATAFORMA_URL     endereço da plataforma de recebimento
//   PLATAFORMA_CHAVE   chave do produto cifra-pronta na plataforma
//   WEBHOOK_SEGREDO    segredo compartilhado que assina os avisos

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

const PRODUTO = 'cifra-pronta'
const REFERENCIA = 'assinatura-mensal'
const VALOR_CENTAVOS = 2990
const EXPIRA_SEGUNDOS = 900
const ORIGEM = 'plataforma-propria'
/** Quanto tempo uma cobrança recém-criada é reaproveitada em vez de virar outra. */
const REAPROVEITA_MS = 10 * 60_000

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
const PLATAFORMA_URL = (Deno.env.get('PLATAFORMA_URL') ?? '').replace(/\/+$/, '')
const PLATAFORMA_CHAVE = Deno.env.get('PLATAFORMA_CHAVE') ?? ''
const WEBHOOK_SEGREDO = Deno.env.get('WEBHOOK_SEGREDO') ?? ''

const HEADERS = {
  apikey: SERVICE,
  Authorization: 'Bearer ' + SERVICE,
  'Content-Type': 'application/json',
}

// ===================== a régua da licença =====================
// Copiada de src/engine/licenca.ts. NÃO EDITAR SÓ AQUI: o teste
// src/engine/cobranca.test.ts compara as duas cópias e quebra.

type Plano = 'gratis' | 'pago'

interface Licenca {
  plano: Plano
  validaAte: number
  conferidaEm: number
  renova?: boolean
}

type EventoPagamento = 'compra' | 'renovacao' | 'atraso' | 'cancelamento' | 'reembolso'

const DIA = 86_400_000
const CARENCIA_DIAS = 5
const PERIODO_DIAS = 31

// <<< regra-da-cobranca
/**
 * Tabela de decisão da cobrança. É esta função que a função de borda usa ao
 * receber o webhook, seja qual for a plataforma: o tradutor de cada uma só
 * precisa entregar um EventoPagamento.
 *
 * ATENÇÃO: copiada letra por letra dentro de supabase/functions/pagamento/,
 * porque função de borda é um arquivo só. O teste cobranca.test.ts compara as
 * duas cópias e quebra se alguém mexer em uma e esquecer a outra.
 */
export function aplicarEventoDePagamento(atual: Licenca, evento: EventoPagamento, agora: number): Licenca {
  const periodo = PERIODO_DIAS * DIA
  switch (evento) {
    case 'compra':
      return { plano: 'pago', validaAte: agora + periodo, conferidaEm: agora, renova: true }
    case 'renovacao':
      // renovação atrasada não pode encurtar o período de quem estava em dia
      return { plano: 'pago', validaAte: Math.max(agora, atual.validaAte) + periodo, conferidaEm: agora, renova: true }
    case 'atraso':
      // cartão recusado: mantém de pé pela carência, sem estender quem já tem prazo maior
      return {
        plano: 'pago',
        validaAte: Math.max(atual.validaAte, agora + CARENCIA_DIAS * DIA),
        conferidaEm: agora,
        renova: atual.renova ?? true,
      }
    case 'cancelamento':
      // já pagou o mês: usa até o fim, e só não renova
      return { plano: 'pago', validaAte: atual.validaAte, conferidaEm: agora, renova: false }
    case 'reembolso':
      // devolveu o dinheiro: acesso pago acaba na hora (as músicas ficam)
      return { plano: 'gratis', validaAte: 0, conferidaEm: agora, renova: false }
  }
}
// >>> regra-da-cobranca

// ===================== as regras do aviso =====================
// Copiadas de src/engine/cobranca.ts, mesma história: o teste compara.

// <<< regras-do-aviso

/** Um aviso já conferido e traduzido para o vocabulário do app. */
export interface AvisoDePagamento {
  evento: EventoPagamento
  produto: string
  email: string
  externoId: string
  ocorridoEm: number
}

/** Os cinco eventos que a régua da licença sabe aplicar. Nada além disso entra. */
export const EVENTOS_ACEITOS: readonly EventoPagamento[] = [
  'compra',
  'renovacao',
  'atraso',
  'cancelamento',
  'reembolso',
]

/**
 * Quanto o carimbo de hora do aviso pode estar longe do relógio do servidor.
 *
 * Serve contra repetição: sem janela, um aviso legítimo capturado hoje valeria
 * para sempre, e bastaria reenviá-lo todo mês para ganhar assinatura de graça.
 * Cinco minutos cobrem relógio torto e fila de reentrega sem abrir essa porta.
 */
export const JANELA_MS = 5 * 60_000

/**
 * O aviso está dentro da janela? Vale para os dois lados: carimbo velho é
 * repetição, carimbo no futuro é relógio adulterado.
 */
export function carimboVale(carimboSegundos: number, agora: number): boolean {
  if (!Number.isFinite(carimboSegundos)) return false
  return Math.abs(agora - carimboSegundos * 1000) <= JANELA_MS
}

/**
 * Lê o corpo do aviso. Devolve o aviso pronto ou o motivo da recusa.
 *
 * O e-mail vira minúsculo aqui, e não depois: é ele que liga a compra à
 * pessoa, e "Eder@" e "eder@" precisam ser a mesma linha da tabela.
 */
export function leAviso(corpo: unknown, produtoEsperado: string): { aviso: AvisoDePagamento } | { erro: string } {
  if (typeof corpo !== 'object' || corpo === null) return { erro: 'corpo não é um objeto' }
  const c = corpo as Record<string, unknown>

  const evento = typeof c.evento === 'string' ? c.evento : ''
  if (!(EVENTOS_ACEITOS as readonly string[]).includes(evento)) return { erro: 'evento desconhecido' }

  const produto = typeof c.produto === 'string' ? c.produto.trim() : ''
  if (produto !== produtoEsperado) return { erro: 'aviso de outro produto' }

  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : ''
  // conferência de e-mail deliberadamente frouxa: quem valida de verdade é o
  // servidor de contas na hora de entrar. Aqui só barra o que é claramente lixo
  if (!email || !email.includes('@') || email.length > 320) return { erro: 'e-mail ausente ou inválido' }

  const externoId = typeof c.externoId === 'string' ? c.externoId.trim() : ''
  if (!externoId || externoId.length > 120) return { erro: 'externoId ausente ou grande demais' }

  const ocorridoEm = typeof c.ocorridoEm === 'string' ? Date.parse(c.ocorridoEm) : NaN
  if (!Number.isFinite(ocorridoEm)) return { erro: 'ocorridoEm ausente ou fora do formato' }

  return { aviso: { evento: evento as EventoPagamento, produto, email, externoId, ocorridoEm } }
}

/**
 * O que identifica um aviso para efeito de repetição.
 *
 * A plataforma entrega PELO MENOS UMA VEZ: se a resposta se perder no caminho,
 * ela manda de novo o mesmo aviso. Sem esta chave, uma reentrega viraria um mês
 * de assinatura de brinde. Entra o evento junto do id porque a mesma cobrança
 * pode gerar compra hoje e reembolso amanhã.
 */
export function chaveDoAviso(aviso: AvisoDePagamento): string {
  return aviso.externoId + ':' + aviso.evento
}

/**
 * Compara duas assinaturas em tempo constante.
 *
 * Com `===`, o navegador para no primeiro caractere diferente, e o tempo de
 * resposta entrega, byte a byte, qual era a assinatura certa. São milhares de
 * tentativas, mas é um ataque conhecido e a defesa custa três linhas.
 */
export function mesmaAssinatura(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

// >>> regras-do-aviso

// ===================== conversas com o mundo =====================

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

const enc = new TextEncoder()

function paraHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA256 de `carimbo.corpo` com o segredo compartilhado, em hexadecimal. */
async function assina(carimbo: string, corpoBruto: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', enc.encode(WEBHOOK_SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return paraHex(await crypto.subtle.sign('HMAC', chave, enc.encode(carimbo + '.' + corpoBruto)))
}

interface LinhaAssinatura {
  email: string
  plano: string
  valida_ate: string | null
  renova: boolean
}

async function assinaturaDe(email: string): Promise<LinhaAssinatura | null> {
  const url = `${BASE}/rest/v1/assinaturas?email=eq.${encodeURIComponent(email)}&select=email,plano,valida_ate,renova`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error('banco respondeu ' + res.status)
  return ((await res.json()) as LinhaAssinatura[])[0] ?? null
}

/**
 * Grava o evento. Devolve false quando ele JÁ ESTAVA lá.
 *
 * A repetição é barrada pelo índice único do banco, não por um "select antes
 * de inserir": dois avisos iguais chegando ao mesmo tempo passariam os dois
 * pelo select e virariam dois meses. O banco decide, e decide uma vez só.
 */
async function gravaEvento(aviso: AvisoDePagamento, corpo: unknown): Promise<boolean> {
  const res = await fetch(BASE + '/rest/v1/eventos_pagamento', {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({
      email: aviso.email,
      evento: aviso.evento,
      origem: ORIGEM,
      externo_id: aviso.externoId,
      corpo,
    }),
  })
  if (res.status === 409) return false // índice único: aviso repetido
  if (!res.ok) throw new Error('não deu para gravar o evento: ' + res.status)
  return true
}

/** Trilha do que foi recusado depois de a assinatura conferir. Nunca joga erro. */
async function anotaRecusa(motivo: string, corpoBruto: string): Promise<void> {
  try {
    await fetch(BASE + '/rest/v1/eventos_pagamento', {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        evento: 'recusado',
        origem: ORIGEM,
        corpo: { motivo, bruto: corpoBruto.slice(0, 2000) },
      }),
    })
  } catch {
    // a trilha é um conforto, não uma dependência: nunca derruba o webhook
  }
}

async function salvaAssinatura(email: string, nova: Licenca, externoId: string): Promise<void> {
  const res = await fetch(BASE + '/rest/v1/assinaturas', {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      email,
      plano: nova.plano,
      valida_ate: nova.validaAte > 0 ? new Date(nova.validaAte).toISOString() : null,
      renova: nova.renova !== false,
      origem: ORIGEM,
      externo_id: externoId,
      atualizada_em: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error('não deu para salvar a assinatura: ' + res.status)
}

/** A cobrança que esta pessoa criou há pouco e ainda vale, se houver. */
async function cobrancaRecente(email: string): Promise<Record<string, unknown> | null> {
  const desde = new Date(Date.now() - REAPROVEITA_MS).toISOString()
  const url =
    `${BASE}/rest/v1/eventos_pagamento?email=eq.${encodeURIComponent(email)}` +
    `&evento=eq.cobranca-criada&recebido_em=gte.${encodeURIComponent(desde)}` +
    `&select=corpo&order=recebido_em.desc&limit=1`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const linhas = (await res.json()) as { corpo: Record<string, unknown> }[]
  const corpo = linhas[0]?.corpo
  if (!corpo) return null
  const expira = typeof corpo.expiraEm === 'string' ? Date.parse(corpo.expiraEm) : 0
  return expira > Date.now() + 30_000 ? corpo : null
}

interface RespostaDaPlataforma {
  id?: string
  copia_e_cola?: string
  qr_png_base64?: string
  expira_em?: string
}

/** Pede a cobrança na plataforma de recebimento. Devolve já no formato do app. */
async function pedeCobranca(email: string): Promise<Record<string, unknown>> {
  const res = await fetch(PLATAFORMA_URL + '/v1/cobrancas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PLATAFORMA_CHAVE },
    body: JSON.stringify({
      produto: PRODUTO,
      referencia: REFERENCIA,
      email,
      valor_centavos: VALOR_CENTAVOS,
      expira_em_segundos: EXPIRA_SEGUNDOS,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error('a plataforma respondeu ' + res.status)
  const d = (await res.json()) as RespostaDaPlataforma
  if (!d.id || !d.copia_e_cola) throw new Error('a plataforma respondeu sem o código Pix')
  return {
    id: d.id,
    copiaECola: d.copia_e_cola,
    qrPngBase64: d.qr_png_base64 ?? '',
    expiraEm: d.expira_em ?? new Date(Date.now() + EXPIRA_SEGUNDOS * 1000).toISOString(),
    valorCentavos: VALOR_CENTAVOS,
  }
}

// ===================== as duas portas =====================

async function porWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('somente POST', { status: 405 })
  if (!WEBHOOK_SEGREDO) return new Response('webhook não configurado', { status: 503 })

  const carimbo = req.headers.get('x-cp-carimbo') ?? ''
  const enviada = (req.headers.get('x-cp-assinatura') ?? '').replace(/^sha256=/i, '').toLowerCase()
  // o corpo BRUTO, antes de virar objeto: a assinatura é sobre estes bytes, e
  // reserializar o JSON mudaria espaços e ordem e derrubaria avisos legítimos
  const corpoBruto = await req.text()

  if (!carimbo || !enviada) return new Response('faltam os cabeçalhos de assinatura', { status: 401 })
  if (!mesmaAssinatura(enviada, await assina(carimbo, corpoBruto))) {
    return new Response('assinatura não confere', { status: 401 })
  }
  // daqui para baixo já se sabe que quem mandou tem o segredo: a partir deste
  // ponto vale anotar a recusa, porque não dá mais para encher a tabela de fora

  if (!carimboVale(Number(carimbo), Date.now())) {
    await anotaRecusa('carimbo fora da janela', corpoBruto)
    return new Response('carimbo fora da janela', { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(corpoBruto)
  } catch {
    await anotaRecusa('corpo não é JSON', corpoBruto)
    return new Response('corpo não é JSON', { status: 400 })
  }

  const lido = leAviso(corpo, PRODUTO)
  if ('erro' in lido) {
    await anotaRecusa(lido.erro, corpoBruto)
    return new Response(lido.erro, { status: 400 })
  }
  const aviso = lido.aviso

  try {
    const novo = await gravaEvento(aviso, corpo)
    if (!novo) {
      // reentrega: responder 200 é o que faz a plataforma parar de repetir
      return Response.json({ ok: true, repetido: true })
    }

    const linha = await assinaturaDe(aviso.email)
    const atual: Licenca = {
      plano: linha?.plano === 'pago' ? 'pago' : 'gratis',
      validaAte: linha?.valida_ate ? Date.parse(linha.valida_ate) : 0,
      conferidaEm: 0,
      renova: linha?.renova !== false,
    }
    // o relógio é o do SERVIDOR, não o carimbo da plataforma: um aviso atrasado
    // na fila não pode encurtar nem esticar o mês de quem pagou
    await salvaAssinatura(aviso.email, aplicarEventoDePagamento(atual, aviso.evento, Date.now()), aviso.externoId)
    return Response.json({ ok: true })
  } catch (e) {
    // 5xx faz a plataforma repetir, que é exatamente o que se quer quando o
    // banco piscou: o dinheiro já entrou e a licença precisa entrar também
    return new Response(e instanceof Error ? e.message : 'falhou', { status: 502 })
  }
}

async function porCobrar(req: Request, origin: string): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const email = await quemE(token)
  if (!email) return json({ error: 'entre na sua conta primeiro' }, 401, origin)

  if (!PLATAFORMA_URL || !PLATAFORMA_CHAVE) {
    return json({ error: 'a cobrança automática ainda não está ligada' }, 503, origin)
  }

  try {
    const guardada = await cobrancaRecente(email)
    if (guardada) return json({ ...guardada, email, reaproveitada: true }, 200, origin)

    const cobranca = await pedeCobranca(email)
    // a trilha da cobrança serve para o reaproveitamento acima e para responder
    // depois a "gerei o código e não paguei, e agora?"
    await fetch(BASE + '/rest/v1/eventos_pagamento', {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        email,
        evento: 'cobranca-criada',
        origem: ORIGEM,
        externo_id: String(cobranca.id),
        corpo: cobranca,
      }),
    })
    return json({ ...cobranca, email }, 200, origin)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'falhou' }, 502, origin)
  }
}

Deno.serve(async (req: Request) => {
  // o webhook vem antes de tudo: ele não tem origem, não tem crachá e não pode
  // ser barrado por regra de navegador, que é coisa de app e não de servidor
  if (new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/webhook')) return porWebhook(req)

  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  // sem `origin &&`: pedido sem cabeçalho de origem é pedido de fora do navegador
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origem não autorizada' }, 403, origin)
  if (req.method !== 'POST') return json({ error: 'somente POST' }, 405, origin)

  let body: { op?: string }
  try {
    body = (await req.json()) as { op?: string }
  } catch {
    body = {}
  }
  if (body.op && body.op !== 'cobrar') return json({ error: 'use op=cobrar' }, 400, origin)

  return porCobrar(req, origin)
})
