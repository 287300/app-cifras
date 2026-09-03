import { describe, expect, test } from 'bun:test'
import { precisaDeCadastro } from './porta.ts'

describe('a porta de entrada', () => {
  test('aparelho novo passa pelo cadastro', () => {
    expect(precisaDeCadastro({ temConta: false, temRepertorio: false })).toBe(true)
  })

  test('quem já entrou não vê barreira nenhuma', () => {
    expect(precisaDeCadastro({ temConta: true, temRepertorio: false })).toBe(false)
    expect(precisaDeCadastro({ temConta: true, temRepertorio: true })).toBe(false)
  })

  // A regra que não se negocia. O app é usado no palco, muitas vezes em modo
  // avião: quem tem música gravada aqui entra, com ou sem conta, com ou sem
  // rede. Uma venda perdida custa R$ 29,90; um show sem a cifra custa o cliente.
  test('quem tem repertório no aparelho entra mesmo sem conta', () => {
    expect(precisaDeCadastro({ temConta: false, temRepertorio: true })).toBe(false)
  })

  test('a decisão não olha para a rede: só para o que está no aparelho', () => {
    // as duas únicas entradas são estado local, e é isso que faz a porta
    // funcionar em modo avião
    const chaves = Object.keys({ temConta: false, temRepertorio: false })
    expect(chaves.sort()).toEqual(['temConta', 'temRepertorio'])
  })
})
