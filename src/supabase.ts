// Endereço e chave pública do servidor. Ficam em um lugar só para não haver
// duas verdades quando o projeto mudar de casa.
//
// A chave abaixo é a PÚBLICA (anon): ela só serve para bater na porta. Quem
// abre o cofre é a chave de serviço, que vive apenas dentro das funções de
// borda e nunca entra neste pacote.

export const SUPABASE_URL = 'https://wgqygvywbedrcwhqbqkz.supabase.co'

export const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndncXlndnl3YmVkcmN3aHFicWt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODI2MzAsImV4cCI6MjEwMzk1ODYzMH0.twSlAiZPPd2QjZ4p2DUGfbbFoa4ZdnIZzfRO_mvtRiw'

export const FUNCOES = SUPABASE_URL + '/functions/v1'
