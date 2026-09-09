import { describe, expect, test } from 'bun:test'
import { FUNCOES, SUPABASE_ANON, SUPABASE_URL } from './supabase.ts'

// A chave pública mora no `app.js` publicado, que é um arquivo aberto na
// internet. Isso é por desenho: ela só bate na porta, e quem diz QUEM está
// entrando é o crachá da pessoa. O que NÃO pode acontecer é a chave de serviço
// escorregar para cá algum dia — ela ignora RLS e abre o banco inteiro.

describe('a chave pública do app', () => {
  test('é a publicável nova, não a anon legada', () => {
    // achado S7: a anon antiga é um JWT HS256 e sai de circulação até o fim de
    // 2026. Trocar antes de ter cliente pagando mexe com dois aparelhos;
    // depois, mexe com todos
    expect(SUPABASE_ANON.startsWith('sb_publishable_')).toBe(true)
    expect(SUPABASE_ANON.startsWith('eyJ')).toBe(false)
  })

  test('NUNCA é uma chave de serviço', () => {
    // esta é a linha que separa "bater na porta" de "abrir o cofre". Uma chave
    // de serviço aqui iria para dentro do app.js publicado, e daria o banco
    // inteiro a qualquer pessoa com o endereço do site
    expect(SUPABASE_ANON).not.toContain('sb_secret_')
    expect(SUPABASE_ANON).not.toContain('service_role')
  })

  test('o endereço é o do projeto, e as funções penduram nele', () => {
    expect(SUPABASE_URL.startsWith('https://')).toBe(true)
    expect(FUNCOES).toBe(SUPABASE_URL + '/functions/v1')
  })
})
