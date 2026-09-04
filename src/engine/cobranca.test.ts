import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { carimboVale, chaveDoAviso, leAviso, mesmaAssinatura, type AvisoDePagamento } from './cobranca.ts'

const AGORA = Date.UTC(2026, 8, 4, 21, 0, 0)
const bom = {
  evento: 'compra',
  produto: 'cifra-pronta',
  email: 'Musico@Exemplo.com',
  externo_id: 'cob_01H',
  ocorrido_em: '2026-09-04T21:00:00.000Z',
}

function ok(corpo: unknown): AvisoDePagamento {
  const lido = leAviso(corpo, 'cifra-pronta')
  if ('erro' in lido) throw new Error('esperava passar, recusou por: ' + lido.erro)
  return lido.aviso
}

function recusa(corpo: unknown): string {
  const lido = leAviso(corpo, 'cifra-pronta')
  if (!('erro' in lido)) throw new Error('esperava recusar, mas passou')
  return lido.erro
}

describe('leitura do aviso da plataforma', () => {
  test('um aviso completo passa e vira o vocabulário do app', () => {
    expect(ok(bom)).toEqual({
      evento: 'compra',
      produto: 'cifra-pronta',
      email: 'musico@exemplo.com',
      externoId: 'cob_01H',
      ocorridoEm: Date.parse('2026-09-04T21:00:00.000Z'),
    })
  })

  test('o e-mail vira minúsculo, senão duas grafias viram duas pessoas', () => {
    expect(ok({ ...bom, email: '  EDER@Exemplo.COM ' }).email).toBe('eder@exemplo.com')
  })

  test('os cinco eventos da régua passam, e só eles', () => {
    for (const evento of ['compra', 'renovacao', 'atraso', 'cancelamento', 'reembolso']) {
      expect(ok({ ...bom, evento }).evento).toBe(evento as AvisoDePagamento['evento'])
    }
    expect(recusa({ ...bom, evento: 'liberar' })).toBe('evento desconhecido')
    expect(recusa({ ...bom, evento: '' })).toBe('evento desconhecido')
    expect(recusa({ ...bom, evento: 42 })).toBe('evento desconhecido')
  })

  test('aviso de outro produto não mexe na licença deste', () => {
    expect(recusa({ ...bom, produto: 'outro-app' })).toBe('aviso de outro produto')
    expect(recusa({ ...bom, produto: undefined })).toBe('aviso de outro produto')
  })

  test('sem e-mail não há a quem liberar', () => {
    expect(recusa({ ...bom, email: '' })).toBe('e-mail ausente ou inválido')
    expect(recusa({ ...bom, email: 'sem-arroba' })).toBe('e-mail ausente ou inválido')
    expect(recusa({ ...bom, email: 'a@' + 'b'.repeat(400) })).toBe('e-mail ausente ou inválido')
  })

  test('sem externo_id não dá para barrar repetição', () => {
    expect(recusa({ ...bom, externo_id: '' })).toBe('externo_id ausente ou grande demais')
    expect(recusa({ ...bom, externo_id: 'x'.repeat(200) })).toBe('externo_id ausente ou grande demais')
  })

  test('data fora do formato é recusada', () => {
    expect(recusa({ ...bom, ocorrido_em: 'ontem' })).toBe('ocorrido_em ausente ou fora do formato')
    expect(recusa({ ...bom, ocorrido_em: 1757012345 })).toBe('ocorrido_em ausente ou fora do formato')
  })

  test('corpo que não é objeto não derruba a função', () => {
    expect(recusa(null)).toBe('corpo não é um objeto')
    expect(recusa('compra')).toBe('corpo não é um objeto')
    expect(recusa([])).toBe('evento desconhecido')
  })
})

describe('janela do carimbo', () => {
  test('agora vale', () => {
    expect(carimboVale(AGORA / 1000, AGORA)).toBe(true)
  })

  test('quatro minutos para trás ou para frente ainda valem', () => {
    expect(carimboVale((AGORA - 4 * 60_000) / 1000, AGORA)).toBe(true)
    expect(carimboVale((AGORA + 4 * 60_000) / 1000, AGORA)).toBe(true)
  })

  test('seis minutos não valem: aviso velho é aviso repetido', () => {
    expect(carimboVale((AGORA - 6 * 60_000) / 1000, AGORA)).toBe(false)
  })

  test('carimbo no futuro distante não vale', () => {
    expect(carimboVale((AGORA + 60 * 60_000) / 1000, AGORA)).toBe(false)
  })

  test('carimbo que não é número não vale', () => {
    expect(carimboVale(Number.NaN, AGORA)).toBe(false)
    expect(carimboVale(Number('abc'), AGORA)).toBe(false)
  })
})

describe('chave de repetição', () => {
  test('a mesma cobrança com o mesmo evento dá a mesma chave', () => {
    expect(chaveDoAviso(ok(bom))).toBe(chaveDoAviso(ok({ ...bom })))
  })

  test('compra e reembolso da mesma cobrança são avisos diferentes', () => {
    expect(chaveDoAviso(ok(bom))).not.toBe(chaveDoAviso(ok({ ...bom, evento: 'reembolso' })))
  })
})

describe('comparação da assinatura', () => {
  test('iguais batem', () => {
    expect(mesmaAssinatura('a1b2c3', 'a1b2c3')).toBe(true)
  })

  test('um caractere diferente não bate', () => {
    expect(mesmaAssinatura('a1b2c3', 'a1b2c4')).toBe(false)
  })

  test('tamanhos diferentes não batem', () => {
    expect(mesmaAssinatura('a1b2c3', 'a1b2c')).toBe(false)
    expect(mesmaAssinatura('', 'a')).toBe(false)
  })
})

// ---------- as duas cópias precisam ser a mesma coisa ----------
//
// A função de borda do Supabase é um arquivo só e não importa nada de src/.
// Então a régua da licença e as regras do aviso existem duas vezes: aqui, onde
// dá para testar, e lá, onde rodam. Estes dois testes são o que impede que uma
// mude sem a outra — que é o defeito que ninguém percebe até alguém pagar e o
// app não liberar.

const RAIZ = join(import.meta.dir, '..', '..')

function regiao(caminho: string, marca: string): string {
  const texto = readFileSync(join(RAIZ, caminho), 'utf8')
  const inicio = texto.indexOf('// <<< ' + marca)
  const fim = texto.indexOf('// >>> ' + marca)
  if (inicio < 0 || fim < 0) throw new Error(`não achei a marca ${marca} em ${caminho}`)
  return texto.slice(inicio, fim).trim()
}

describe('as cópias na função de borda', () => {
  test('a régua da licença é a mesma no app e no servidor', () => {
    expect(regiao('supabase/functions/pagamento/index.ts', 'regra-da-cobranca')).toBe(
      regiao('src/engine/licenca.ts', 'regra-da-cobranca')
    )
  })

  test('as regras do aviso são as mesmas no app e no servidor', () => {
    expect(regiao('supabase/functions/pagamento/index.ts', 'regras-do-aviso')).toBe(
      regiao('src/engine/cobranca.ts', 'regras-do-aviso')
    )
  })

  test('os prazos da régua não divergem', () => {
    const borda = readFileSync(join(RAIZ, 'supabase/functions/pagamento/index.ts'), 'utf8')
    const engine = readFileSync(join(RAIZ, 'src/engine/licenca.ts'), 'utf8')
    for (const nome of ['DIA', 'CARENCIA_DIAS', 'PERIODO_DIAS']) {
      const re = new RegExp(`const ${nome} = ([0-9_]+)`)
      expect(borda.match(re)?.[1]).toBe(engine.match(re)?.[1] as string)
    }
  })
})
