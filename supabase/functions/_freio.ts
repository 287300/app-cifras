// FONTE DO FREIO DE MÃO. Este arquivo não é publicado: ele é a cópia-mestra.
//
// As funções de borda do Supabase são cada uma um arquivo só, sem import de
// nada. Então o freio existe cinco vezes: aqui, onde se lê e se compara, e uma
// vez dentro de cada uma das quatro funções, onde ele roda.
//
// O trecho entre as duas marcas abaixo (as linhas com "freio-de-mao") é
// IDÊNTICO, byte a byte, nos cinco arquivos. Quem garante isso é o teste em
// `src/engine/freio.test.ts`. Mexeu aqui, tem que colar nas quatro.
//
// As marcas aparecem UMA VEZ SÓ em cada arquivo, de propósito: quem extrai o
// trecho procura a primeira ocorrência, e uma menção num comentário faria a
// cópia sair pela metade sem ninguém perceber.
//
// O que fica FORA do trecho, e por isso muda de função para função: `BASE`,
// `HEADERS`, `json()`, a constante `FUNCAO` e os dois tetos.

declare const BASE: string
declare const HEADERS: Record<string, string>
declare const FUNCAO: string
declare function json(data: unknown, status: number, origin: string): Response

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
