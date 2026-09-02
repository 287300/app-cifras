import { describe, expect, test } from 'bun:test'
import { decideDono, resumoDoQueSai } from './biblioteca.ts'

describe('de quem é a biblioteca deste aparelho', () => {
  test('aparelho sem dono adota quem entrar, com ou sem música', () => {
    expect(decideDono('', 'user-1', true)).toBe('adotar')
    expect(decideDono('', 'user-1', false)).toBe('adotar')
  })

  test('a mesma conta entrando de novo não mexe em nada', () => {
    expect(decideDono('user-1', 'user-1', true)).toBe('seguir')
    expect(decideDono('user-1', 'user-1', false)).toBe('seguir')
  })

  test('outra conta num aparelho com repertório: nunca mistura, avisa antes', () => {
    expect(decideDono('user-1', 'user-2', true)).toBe('trocar')
  })

  test('outra conta num aparelho vazio entra direto: não há o que perder', () => {
    expect(decideDono('user-1', 'user-2', false)).toBe('adotar')
  })

  test('sem saber quem está entrando, não faz nada', () => {
    expect(decideDono('user-1', '', true)).toBe('seguir')
    expect(decideDono('', '', false)).toBe('seguir')
  })
})

describe('o aviso do que sai na troca de conta', () => {
  test('fala em música e show, no singular e no plural', () => {
    expect(resumoDoQueSai(1, 1)).toBe('1 música e 1 show')
    expect(resumoDoQueSai(14, 2)).toBe('14 músicas e 2 shows')
  })

  test('não inventa show quando não há nenhum', () => {
    expect(resumoDoQueSai(14, 0)).toBe('14 músicas')
    expect(resumoDoQueSai(0, 3)).toBe('3 shows')
    expect(resumoDoQueSai(0, 0)).toBe('nada')
  })
})
