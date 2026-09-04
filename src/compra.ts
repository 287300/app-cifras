// Tudo o que a assinatura precisa dizer na tela, em um lugar só.
//
// Desde 04/09/2026 a compra é dentro do app: o botão "Quero assinar" leva para
// a tela #/assinar, que gera o Pix e espera o dinheiro cair. Não há mais link
// para fora nem checkout de terceiro.
//
// Quem gera a cobrança de verdade é a plataforma de recebimento, que vive em
// projeto próprio. O app só conhece a função de borda `pagamento`, e é por isso
// que trocar de meio de recebimento não encosta em nada daqui.

export const PRECO = 'R$ 29,90 por mês'

/** Para onde a pessoa escreve quando quer assinar (ou quando algo deu errado). */
export const CONTATO = 'contato@cifrapronta.com.br'

/** O que a assinatura destrava, na ordem em que importa para um músico. */
export const VANTAGENS = [
  'Biblioteca sem limite de músicas',
  'Quantos shows você quiser, cada um na sua ordem',
  'As mesmas músicas no iPad e no celular, sincronizadas',
  'Sem anúncio nenhum, no palco ou fora dele',
]
