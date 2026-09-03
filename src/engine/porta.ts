// A porta de entrada do app: quem precisa criar conta antes de usar.
//
// A decisão comercial é "sem conta, sem app": aparelho novo passa pelo cadastro
// grátis antes de ver qualquer tela. É o que transforma visita em cliente, e é
// barato para quem chega, porque não pede cartão nem senha.
//
// A RESSALVA QUE NÃO SE NEGOCIA: quem já tem música gravada NESTE aparelho
// nunca vê a barreira. O app é usado no palco, muitas vezes em modo avião, e
// trancar um músico do lado de fora do próprio repertório porque o servidor de
// contas não respondeu seria o pior defeito que este produto poderia ter. Uma
// venda perdida custa R$ 29,90; um show tocado sem a cifra custa o cliente.
//
// Por isso a regra olha para o que está NO APARELHO, nunca para a rede.

export type Situacao = {
  /** já entrou com e-mail neste aparelho (vale offline: a conta fica gravada) */
  temConta: boolean
  /** já existe música ou show gravado aqui */
  temRepertorio: boolean
}

export function precisaDeCadastro(s: Situacao): boolean {
  if (s.temConta) return false
  if (s.temRepertorio) return false
  return true
}
