// Ensaio do freio de mão: roda a função `licenca` DE VERDADE contra um
// Supabase de mentira e confere que ela freia, e que ela freia do jeito certo.
//
// Por que isto existe. O teste em `src/engine/freio.test.ts` compara texto: ele
// garante que as quatro cópias são iguais, não que o freio funciona. Aqui a
// função é carregada e atendida como no servidor, com um `Deno` de mentira, e o
// que se confere é comportamento:
//
//   1. abaixo do teto passa;
//   2. acima do teto responde 429, e o recado é em português;
//   3. o freio conta pelo ENDEREÇO antes de perguntar quem é: uma enxurrada
//      anônima não pode queimar a chamada ao servidor de contas;
//   4. BANCO MUDO DEIXA PASSAR. Este é o mais importante. Um problema nosso não
//      pode virar "muitos pedidos" na cara de quem está pagando e só quer abrir
//      o show.
//
// O QUE A JANELA FIXA NÃO PEGA, e é de propósito. O balde de tempo entra na
// chave, então ele vira na virada do minuto. Quem disparar 40 pedidos às
// 10:00:59 e mais 40 às 10:01:01 faz 80 em dois segundos sem tomar 429: são dois
// baldes. Isso apareceu na prova em produção de 09/09, quando a rajada caiu
// justamente na virada e nenhum dos dois baldes passou do teto.
//
// Fica assim porque o teto por minuto não é o que protege a fatura: quem protege
// é o teto POR DIA, que não tem virada para explorar. O do minuto existe para
// cortar o laço na primeira rajada, e cortar em 80 em vez de 40 uma vez a cada
// hora não muda nada na conta do fim do mês. Janela deslizante custaria mais
// idas ao banco em TODO pedido, inclusive nos legítimos.
//
// Roda com: bun run scripts/ensaio-freio.ts

const PORTA_SUPABASE = 8791

let passos = 0
let ruins = 0
function confere(nome: string, ok: boolean, detalhe = ''): void {
  passos++
  if (ok) {
    console.log('  ok: ' + nome)
  } else {
    ruins++
    console.log('  FALHOU: ' + nome + (detalhe ? ' — ' + detalhe : ''))
  }
}

// ---------- o Supabase de mentira ----------

/** Contadores por chave, como a tabela uso_por_janela faz no banco de verdade. */
const contagem = new Map<string, number>()
let bancoMudo = false
let chamadasAoServidorDeContas = 0
let chamadasDeContagem = 0

const supabase = Bun.serve({
  port: PORTA_SUPABASE,
  fetch: async (req) => {
    const url = new URL(req.url)

    if (url.pathname === '/rest/v1/rpc/registra_uso') {
      chamadasDeContagem++
      if (bancoMudo) return new Response('boom', { status: 500 })
      const b = (await req.json()) as { p_chave_minuto: string; p_chave_dia: string }
      const n = (chave: string) => {
        const v = (contagem.get(chave) ?? 0) + 1
        contagem.set(chave, v)
        return v
      }
      return Response.json([n(b.p_chave_minuto), n(b.p_chave_dia)])
    }

    if (url.pathname === '/auth/v1/user') {
      chamadasAoServidorDeContas++
      const auth = req.headers.get('authorization') ?? ''
      if (!auth.includes('cracha-bom')) return new Response('{}', { status: 401 })
      return Response.json({ email: 'eder@exemplo.com' })
    }

    if (url.pathname === '/rest/v1/assinaturas') {
      return Response.json([{ email: 'eder@exemplo.com', plano: 'pago', valida_ate: new Date(Date.now() + 86_400_000).toISOString(), renova: true }])
    }

    return new Response('nao esperado: ' + url.pathname, { status: 404 })
  },
})

// ---------- a função de borda, carregada como no servidor ----------

const ambiente: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:' + PORTA_SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico-de-ensaio',
}

let handler: ((req: Request) => Promise<Response>) | null = null
;(globalThis as unknown as Record<string, unknown>).Deno = {
  env: { get: (chave: string) => ambiente[chave] },
  serve: (fn: (req: Request) => Promise<Response>) => {
    handler = fn
  },
}

const caminho = new URL('../supabase/functions/licenca/index.ts', import.meta.url).pathname
await import(caminho)
if (!handler) throw new Error('a função de borda não registrou o atendimento')
const atende = handler as (req: Request) => Promise<Response>

/** Um pedido como o app faz, com endereço e crachá escolhidos. */
function pedido(ip: string, cracha = 'cracha-bom'): Request {
  return new Request('http://borda/licenca', {
    method: 'POST',
    headers: {
      origin: 'https://cifrapronta.com.br',
      'x-forwarded-for': ip + ', 10.0.0.1',
      authorization: 'Bearer ' + cracha,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ op: 'consultar' }),
  })
}

// os tetos que a própria função declara, para o ensaio não decorar número
const fonte = await Bun.file(new URL('../supabase/functions/licenca/index.ts', import.meta.url).pathname).text()
const tetoEndereco = Number(/const TETO_ENDERECO = \{ minuto: (\d+)/.exec(fonte)?.[1])
const tetoConta = Number(/const TETO_CONTA = \{ minuto: (\d+)/.exec(fonte)?.[1])

console.log('\nENSAIO DO FREIO (função licenca, tetos: endereço ' + tetoEndereco + '/min, conta ' + tetoConta + '/min)\n')

// ---------- 1. abaixo do teto, tudo passa ----------

const primeira = await atende(pedido('200.1.1.1'))
confere('o primeiro pedido passa', primeira.status === 200, 'status ' + primeira.status)
confere('e vem com a resposta da licença', ((await primeira.clone().json()) as { plano?: string }).plano === 'pago')

// ---------- 2. o teto da CONTA barra, porque é o menor ----------

let ultima: Response = primeira
for (let i = 0; i < tetoConta + 2; i++) ultima = await atende(pedido('200.1.1.1'))
confere('passando do teto, a resposta é 429', ultima.status === 429, 'status ' + ultima.status)
const recado = ((await ultima.json()) as { error?: string }).error ?? ''
confere('o recado é em português e sem número de erro', /Muitos pedidos/.test(recado) && !/\d{3}/.test(recado), recado)

// ---------- 3. outra conta, no mesmo endereço, não herda a punição ----------

contagem.clear()
const outroEndereco = await atende(pedido('200.9.9.9'))
confere('endereço novo começa do zero', outroEndereco.status === 200, 'status ' + outroEndereco.status)

// ---------- 4. o endereço é contado ANTES de perguntar quem é ----------

contagem.clear()
chamadasAoServidorDeContas = 0
for (let i = 0; i < tetoEndereco + 3; i++) await atende(pedido('45.45.45.45', 'cracha-ruim'))
const depois = await atende(pedido('45.45.45.45', 'cracha-ruim'))
confere('enxurrada anônima leva 429, não 401', depois.status === 429, 'status ' + depois.status)
confere(
  'e para de bater no servidor de contas antes do teto+3',
  chamadasAoServidorDeContas <= tetoEndereco + 1,
  chamadasAoServidorDeContas + ' chamadas para ' + (tetoEndereco + 4) + ' pedidos'
)

// ---------- 5. banco mudo DEIXA PASSAR ----------

contagem.clear()
bancoMudo = true
const comBancoMudo = await atende(pedido('77.77.77.77'))
bancoMudo = false
confere('com o banco fora do ar o pedido passa, não é freado', comBancoMudo.status === 200, 'status ' + comBancoMudo.status)

// ---------- 6. uma ida ao banco por pedido, não duas ----------

contagem.clear()
chamadasDeContagem = 0
await atende(pedido('88.88.88.88'))
confere('o freio custa 2 idas ao banco por pedido (endereço + conta)', chamadasDeContagem === 2, chamadasDeContagem + ' idas')

// ---------- 7. o recado de erro nunca traz detalhe de infraestrutura ----------

contagem.clear()
const semCracha = await atende(pedido('99.99.99.99', 'cracha-ruim'))
const erroSemCracha = ((await semCracha.json()) as { error?: string }).error ?? ''
confere('sem crachá o recado manda entrar, sem número', semCracha.status === 401 && /entre na sua conta/.test(erroSemCracha), erroSemCracha)

supabase.stop(true)

console.log('')
if (ruins === 0) {
  console.log('ENSAIO DO FREIO OK: ' + passos + ' checagens')
  process.exit(0)
}
console.log('ENSAIO DO FREIO FALHOU: ' + ruins + ' de ' + passos)
process.exit(1)
