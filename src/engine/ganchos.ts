// Os ganchos que a fumaça usa para não esperar horas, e por que eles não podem
// existir no aparelho de um cliente.
//
// A ronda da licença é de 6 horas e a da nuvem é de 45 segundos. Um teste que
// respeitasse esses prazos levaria meio dia, então os dois aceitam um atalho
// pelo endereço: `?rondaLic=1000` e `?ronda=1200`.
//
// O PROBLEMA (achado S11 da auditoria de 04/09): eles valiam em qualquer lugar,
// inclusive no site publicado. Digitar
//
//     https://cifrapronta.com.br/app/?rondaLic=999999999
//
// na barra de endereços empurrava a próxima reconferência de licença para daqui
// a 31 anos. Quem descobrisse usava o app pago sem pagar, sem console, sem
// DevTools e sem instalar nada. Nem é preciso entender o que se está fazendo:
// basta copiar um endereço que alguém publicou num fórum.
//
// A trava é o lugar de onde a página está sendo servida. Na máquina de quem
// desenvolve o atalho vale; em qualquer endereço da internet ele simplesmente
// não existe, e o valor de fábrica manda.

/** Endereços que só existem na máquina de quem desenvolve. */
const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Esta página está sendo servida da máquina de quem desenvolve?
 *
 * O casamento é exato, e o sufixo aceito é `.localhost`, que é reservado para
 * esse uso. `localhost.qualquercoisa.com` é um domínio comum da internet como
 * outro qualquer e não entra: seria só registrar esse nome para reabrir a porta.
 */
export function naMaquinaDeQuemDesenvolve(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return LOCAIS.has(h) || h.endsWith('.localhost')
}

/**
 * O prazo de uma ronda, respeitando o atalho de teste só onde ele pode valer.
 *
 * Devolve o valor de fábrica sempre que o gancho não vale, não está presente,
 * não é número, ou é zero ou negativo. Esse último caso não é preciosismo:
 * `?ronda=-1` virava `setInterval(-1)`, que dispara sem parar e trava o app
 * do próprio curioso.
 */
export function prazoDaRonda(search: string, hostname: string, gancho: string, deFabrica: number): number {
  if (!naMaquinaDeQuemDesenvolve(hostname)) return deFabrica
  const pedido = Number(new URLSearchParams(search).get(gancho))
  return Number.isFinite(pedido) && pedido > 0 ? pedido : deFabrica
}
