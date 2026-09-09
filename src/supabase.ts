// Endereço e chave pública do servidor. Ficam em um lugar só para não haver
// duas verdades quando o projeto mudar de casa.
//
// A chave abaixo é a PÚBLICA: ela só serve para bater na porta, e está dentro
// do `app.js`, que é um arquivo aberto na internet. Quem abre o cofre é a chave
// de serviço, que vive apenas dentro das funções de borda e nunca entra neste
// pacote. Quem diz QUEM está entrando é o crachá da pessoa, não esta chave.
//
// TROCA DE 09/09/2026 (achado S7 da auditoria). Até aqui era a chave `anon`
// antiga, um JWT assinado em HS256 e válido até 2036. Esse modelo sai de
// circulação até o fim de 2026, e o momento de trocar é ANTES de existir
// cliente pagando: a chave fica gravada dentro de cada app instalado, então
// trocar hoje mexe com dois aparelhos e trocar depois mexe com todos, cada um
// precisando baixar a versão nova antes de conseguir sincronizar ou conferir
// assinatura — e quem estiver sem internet descobre isso no palco.
//
// A chave antiga continua ligada no painel por enquanto, para não derrubar
// aparelho que ainda não atualizou. Desligar é o último passo, depois que todo
// aparelho estiver na versão nova.

export const SUPABASE_URL = 'https://wgqygvywbedrcwhqbqkz.supabase.co'

export const SUPABASE_ANON = 'sb_publishable_oCyG7TVfjYyPQVw2Po_6hA_0jriIeKf'

export const FUNCOES = SUPABASE_URL + '/functions/v1'
