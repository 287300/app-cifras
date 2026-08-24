import { describe, expect, test } from 'bun:test'
import { contentHash, decryptText, deriveSync, encryptText, importRawKey } from './syncCore.ts'

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

describe('contentHash', () => {
  test('mesmo conteúdo mesmo hash; conteúdo diferente hash diferente', async () => {
    expect(await contentHash('abc')).toBe(await contentHash('abc'))
    expect(await contentHash('abc')).not.toBe(await contentHash('abd'))
    expect(await contentHash('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})
