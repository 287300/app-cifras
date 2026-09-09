import { describe, expect, test } from 'bun:test'
import { naMaquinaDeQuemDesenvolve, prazoDaRonda } from './ganchos.ts'

const SEIS_HORAS = 6 * 60 * 60_000

describe('o gancho de teste só vale na máquina de quem desenvolve', () => {
  // O DEFEITO QUE ISTO IMPEDE (achado S11 da auditoria de 04/09): o atalho
  // valia em qualquer lugar. Digitar ?rondaLic=999999999 na barra de enderecos
  // do site publicado empurrava a reconferencia de licenca para daqui a 31
  // anos, e quem descobrisse usava o app pago sem pagar. Sem console, sem
  // DevTools, sem instalar nada: bastava copiar um endereco.
  test('no site publicado o gancho nao existe: vale o valor de fabrica', () => {
    expect(prazoDaRonda('?rondaLic=999999999', 'cifrapronta.com.br', 'rondaLic', SEIS_HORAS)).toBe(SEIS_HORAS)
    expect(prazoDaRonda('?ronda=999999999', 'www.cifrapronta.com.br', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?rondaLic=1', '287300.github.io', 'rondaLic', SEIS_HORAS)).toBe(SEIS_HORAS)
  })

  test('na maquina de quem desenvolve o atalho continua funcionando', () => {
    // sem isto a fumaça levaria seis horas para conferir uma ronda
    expect(prazoDaRonda('?rondaLic=1000', 'localhost', 'rondaLic', SEIS_HORAS)).toBe(1000)
    expect(prazoDaRonda('?ronda=1200', '127.0.0.1', 'ronda', 45_000)).toBe(1200)
  })

  test('nome parecido com localhost nao abre a porta', () => {
    // seria so registrar localhost.qualquercoisa.com para reabrir o buraco
    expect(naMaquinaDeQuemDesenvolve('localhost.com.br')).toBe(false)
    expect(naMaquinaDeQuemDesenvolve('meu-localhost.com')).toBe(false)
    expect(naMaquinaDeQuemDesenvolve('cifrapronta.com.br')).toBe(false)
    expect(prazoDaRonda('?ronda=5', 'localhost.evil.com', 'ronda', 45_000)).toBe(45_000)
  })

  test('as formas legitimas de dizer "esta maquina" valem', () => {
    for (const h of ['localhost', 'LOCALHOST', ' localhost ', '127.0.0.1', '::1', '[::1]', 'app.localhost']) {
      expect(naMaquinaDeQuemDesenvolve(h)).toBe(true)
    }
  })

  test('gancho ausente, torto ou vazio cai no valor de fabrica', () => {
    expect(prazoDaRonda('', 'localhost', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?ronda=', 'localhost', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?ronda=abc', 'localhost', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?outro=10', 'localhost', 'ronda', 45_000)).toBe(45_000)
  })

  test('zero e negativo nao passam, nem na maquina de quem desenvolve', () => {
    // ?ronda=-1 virava setInterval(-1), que dispara sem parar e trava o app do
    // proprio curioso
    expect(prazoDaRonda('?ronda=0', 'localhost', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?ronda=-1', 'localhost', 'ronda', 45_000)).toBe(45_000)
    expect(prazoDaRonda('?ronda=-999', '127.0.0.1', 'ronda', 45_000)).toBe(45_000)
  })
})
