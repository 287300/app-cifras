import { describe, expect, test } from 'bun:test'
import { codigoCompleto, codigoMorreu, mensagemDoErro, normalizaCodigo, normalizaEmail, precisaRenovar, problemaNoEmail, sugestaoDeEmail, tokenUtilizavel, type Sessao } from './conta.ts'

const AGORA = Date.UTC(2026, 8, 2, 12, 0, 0)
const sessao = (expiraEmMin: number): Sessao => ({
  email: 'ederortega@hotmail.com',
  userId: 'u-1',
  accessToken: 'a',
  refreshToken: 'r',
  expiraEm: AGORA + expiraEmMin * 60_000,
})

describe('e-mail', () => {
  test('tira espaço e maiúscula: o mesmo e-mail escrito de dois jeitos é um só', () => {
    expect(normalizaEmail('  Eder.Ortega@Hotmail.COM ')).toBe('eder.ortega@hotmail.com')
  })

  test('e-mail vazio ou pela metade recebe recado em português', () => {
    expect(problemaNoEmail('')).toBe('Digite o seu e-mail.')
    expect(problemaNoEmail('eder')).toBe('Falta o @ no e-mail.')
    expect(problemaNoEmail('eder@')).toBe('Falta o que vem depois do @, como gmail.com.')
    expect(problemaNoEmail('eder@hotmail')).toBe('Falta o ponto no fim, como .com ou .com.br.')
    expect(problemaNoEmail('eder@@hotmail.com')).toBe('Esse e-mail tem @ demais.')
  })

  test('e-mail certo não reclama de nada', () => {
    expect(problemaNoEmail('ederortega@hotmail.com')).toBe(null)
    expect(problemaNoEmail(' Eder+shows@Gmail.com ')).toBe(null)
  })

  test('erro de dedo no provedor vira sugestão, não erro', () => {
    expect(sugestaoDeEmail('eder@gmail.con')).toBe('eder@gmail.com')
    expect(sugestaoDeEmail('eder@hotmial.com')).toBe('eder@hotmail.com')
    expect(sugestaoDeEmail('eder@gnail.com')).toBe('eder@gmail.com')
    expect(sugestaoDeEmail('eder@hotmail.com')).toBe(null)
    expect(sugestaoDeEmail('eder@dominiodobar.com.br')).toBe(null)
  })

  test('domínio que existe de verdade nunca vira palpite errado', () => {
    // todos estes são provedores reais e ficam a 1 letra do gmail.com
    expect(sugestaoDeEmail('eder@mail.com')).toBe(null)
    expect(sugestaoDeEmail('eder@email.com')).toBe(null)
    expect(sugestaoDeEmail('eder@ymail.com')).toBe(null)
    expect(sugestaoDeEmail('eder@aol.com')).toBe(null)
  })
})

describe('código de 6 números', () => {
  test('aceita como a pessoa digita: com espaço, traço ou colado', () => {
    expect(normalizaCodigo('123 456')).toBe('123456')
    expect(normalizaCodigo('123-456')).toBe('123456')
    expect(normalizaCodigo(' 123456 ')).toBe('123456')
  })

  test('joga fora o que não é número e não passa de 6', () => {
    expect(normalizaCodigo('12a34b56789')).toBe('123456')
    expect(normalizaCodigo('abc')).toBe('')
  })

  test('só está completo com os 6 números', () => {
    expect(codigoCompleto('12345')).toBe(false)
    expect(codigoCompleto('123456')).toBe(true)
  })
})

describe('sessão guardada no aparelho', () => {
  test('token ainda no prazo serve; vencido não serve', () => {
    expect(tokenUtilizavel(sessao(30), AGORA)).toBe(true)
    expect(tokenUtilizavel(sessao(-1), AGORA)).toBe(false)
  })

  test('token que vence em segundos já conta como vencido, para não falhar no meio do pedido', () => {
    expect(tokenUtilizavel(sessao(0.3), AGORA)).toBe(false)
  })

  test('renova em silêncio um pouco antes de vencer, não depois', () => {
    expect(precisaRenovar(sessao(30), AGORA)).toBe(false)
    expect(precisaRenovar(sessao(4), AGORA)).toBe(true)
    expect(precisaRenovar(sessao(-120), AGORA)).toBe(true)
  })
})

describe('recados de erro do servidor', () => {
  test('pedidos demais mandam usar o e-mail que já chegou, sem inventar prazo', () => {
    const r = mensagemDoErro(429, 'over_email_send_rate_limit', 'rate limit')
    expect(r).toMatch(/último|ultimo/i)
    // prometer "espere um minuto" era mentira: o servidor de e-mail conta por
    // hora. A pessoa esperava, tentava, tomava a mesma recusa e concluía que o
    // app estava quebrado
    expect(r).not.toContain('minuto')
  })

  test('link vencido não manda procurar um código que nunca existiu', () => {
    const noLink = mensagemDoErro(400, 'otp_expired', 'Email link is invalid or has expired', 'email')
    expect(noLink).toContain('link')
    const noCodigo = mensagemDoErro(403, 'otp_expired', 'Token has expired', 'codigo')
    expect(noCodigo).toContain('código')
    expect(noCodigo).not.toContain('link')
  })

  test('código vencido e código errado dizem o que fazer', () => {
    expect(mensagemDoErro(403, 'otp_expired', 'Token has expired')).toContain('venceu')
    expect(mensagemDoErro(403, 'otp_expired', 'Token has expired')).toContain('outro')
    expect(mensagemDoErro(401, 'invalid_credentials', 'x')).toContain('Confira')
  })

  test('e-mail recusado pelo servidor fala de e-mail, não de validação', () => {
    expect(mensagemDoErro(400, 'validation_failed', 'Unable to validate email address')).toContain('e-mail')
  })

  test('recusa do e-mail não manda conferir código que ninguém recebeu', () => {
    // texto exato que o servidor devolve: contém "invalid" e enganava o recado
    const m = mensagemDoErro(400, 'validation_failed', 'Unable to validate email address: invalid format')
    expect(m).toContain('e-mail')
    expect(m).not.toContain('6 números')
    expect(mensagemDoErro(400, 'email_address_invalid', 'Email address "x" is invalid')).toContain('e-mail')
  })

  test('sem internet e servidor fora do ar têm recados diferentes', () => {
    expect(mensagemDoErro(0, '', 'Failed to fetch')).toContain('internet')
    expect(mensagemDoErro(500, '', 'boom')).toContain('servidor')
  })

  test('recusa seca na tela do e-mail não manda conferir número nenhum', () => {
    // proxy de wi-fi de casa de show responde 403 pelo servidor
    const m = mensagemDoErro(403, '', 'Forbidden', 'email')
    expect(m).not.toContain('6 números')
    expect(mensagemDoErro(403, '', 'Forbidden', 'codigo')).toContain('6 números')
  })

  test('erro desconhecido nunca devolve texto em inglês cru', () => {
    const m = mensagemDoErro(418, 'teapot', 'I am a teapot')
    expect(m).not.toContain('teapot')
    expect(m.length).toBeGreaterThan(10)
  })
})

describe('o que conta como código queimado', () => {
  test('recusa do servidor queima o código', () => {
    expect(codigoMorreu(403)).toBe(true)
    expect(codigoMorreu(401)).toBe(true)
    expect(codigoMorreu(400)).toBe(true)
    expect(codigoMorreu(422)).toBe(true)
  })

  test('falta de sinal NÃO queima: o código continua bom', () => {
    // este era o beco sem saída: o wi-fi da casa de show engolia a resposta, o
    // app marcava o código certo como morto e a pessoa tocava em "Entrar" sem
    // nada acontecer, com os 6 números certos na tela
    expect(codigoMorreu(0)).toBe(false)
  })

  test('servidor fora do ar e limite de pedidos também não queimam', () => {
    expect(codigoMorreu(500)).toBe(false)
    expect(codigoMorreu(502)).toBe(false)
    expect(codigoMorreu(503)).toBe(false)
    expect(codigoMorreu(429)).toBe(false)
  })

  test('resposta boa não queima nada', () => {
    expect(codigoMorreu(200)).toBe(false)
  })
})
