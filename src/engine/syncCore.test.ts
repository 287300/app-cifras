import { describe, expect, test } from 'bun:test'
import {
  contentHash,
  decryptText,
  deriveFromSecret,
  deriveSync,
  encryptText,
  importRawKey,
  keyFromCode,
  newPairCode,
  pairIdFromCode,
  randomSecret,
} from './syncCore.ts'

describe('deriveSync', () => {
  test('mesma palavra dá sempre o mesmo endereço e a mesma chave', async () => {
    const a = await deriveSync('violao-azul-2026')
    const b = await deriveSync('violao-azul-2026')
    expect(a.id).toBe(b.id)
    expect(a.rawKey).toBe(b.rawKey)
    expect(a.id).toMatch(/^[0-9a-f]{64}$/)
  })

  test('espaços nas pontas não mudam nada; palavra diferente muda tudo', async () => {
    const a = await deriveSync('  violao-azul-2026  ')
    const b = await deriveSync('violao-azul-2026')
    const c = await deriveSync('violao-azul-2027')
    expect(a.id).toBe(b.id)
    expect(c.id).not.toBe(b.id)
    expect(c.rawKey).not.toBe(b.rawKey)
  })
})

describe('cifragem', () => {
  test('ida e volta devolve o texto original (com acentos e quebras)', async () => {
    const { rawKey } = await deriveSync('minha-palavra')
    const key = await importRawKey(rawKey)
    const texto = '{"app":"cifras","songs":[{"title":"Água de Beber\\nIntro"}]}'
    const packed = await encryptText(key, texto)
    expect(packed).toContain('.')
    expect(packed).not.toContain('Água')
    expect(await decryptText(key, packed)).toBe(texto)
  })

  test('cada envio embaralha diferente (iv aleatório), mas abre igual', async () => {
    const { rawKey } = await deriveSync('minha-palavra')
    const key = await importRawKey(rawKey)
    const a = await encryptText(key, 'mesmo conteúdo')
    const b = await encryptText(key, 'mesmo conteúdo')
    expect(a).not.toBe(b)
    expect(await decryptText(key, a)).toBe('mesmo conteúdo')
    expect(await decryptText(key, b)).toBe('mesmo conteúdo')
  })

  test('palavra-chave errada não abre', async () => {
    const certa = await deriveSync('palavra-certa')
    const errada = await deriveSync('palavra-errada')
    const packed = await encryptText(await importRawKey(certa.rawKey), 'segredo')
    await expect(decryptText(await importRawKey(errada.rawKey), packed)).rejects.toBeDefined()
  })
})

describe('sem palavra-chave: segredo sorteado', () => {
  test('cada segredo é diferente e vira um endereço válido', async () => {
    const s1 = randomSecret()
    const s2 = randomSecret()
    expect(s1).not.toBe(s2)
    const a = await deriveFromSecret(s1)
    const b = await deriveFromSecret(s1)
    const c = await deriveFromSecret(s2)
    expect(a.id).toBe(b.id)
    expect(a.rawKey).toBe(b.rawKey)
    expect(a.id).toMatch(/^[0-9a-f]{64}$/)
    expect(c.id).not.toBe(a.id)
  })

  test('a chave derivada do segredo cifra e decifra', async () => {
    const { rawKey } = await deriveFromSecret(randomSecret())
    const key = await importRawKey(rawKey)
    const packed = await encryptText(key, 'setlist do show')
    expect(await decryptText(key, packed)).toBe('setlist do show')
  })
})

describe('código de pareamento', () => {
  test('tem 6 dígitos e vira um endereço temporário', async () => {
    const code = newPairCode()
    expect(code).toMatch(/^[0-9]{6}$/)
    expect(await pairIdFromCode(code)).toMatch(/^[0-9a-f]{64}$/)
    expect(await pairIdFromCode(code)).toBe(await pairIdFromCode(code.slice(0, 3) + ' ' + code.slice(3)))
  })

  test('o segredo viaja embrulhado e só o código certo abre', async () => {
    const code = newPairCode()
    const outro = code === '000000' ? '111111' : '000000'
    const segredo = JSON.stringify(await deriveFromSecret(randomSecret()))
    const wrapped = await encryptText(await keyFromCode(code), segredo)
    expect(wrapped).not.toContain('rawKey')
    expect(await decryptText(await keyFromCode(code), wrapped)).toBe(segredo)
    await expect(decryptText(await keyFromCode(outro), wrapped)).rejects.toBeDefined()
  })
})

describe('contentHash', () => {
  test('mesmo conteúdo mesmo hash; conteúdo diferente hash diferente', async () => {
    expect(await contentHash('abc')).toBe(await contentHash('abc'))
    expect(await contentHash('abc')).not.toBe(await contentHash('abd'))
    expect(await contentHash('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})
