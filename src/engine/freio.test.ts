import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// O freio de mão das funções de borda existe cinco vezes: a cópia-mestra em
// `supabase/functions/_freio.ts`, que não é publicada, e uma dentro de cada uma
// das quatro funções, que é onde ele roda. As funções são cada uma um arquivo
// só e não importam nada, então não há como ser diferente.
//
// Estes testes são o que impede uma das cinco de andar sozinha. Sem eles, o dia
// em que alguém corrigir um erro numa cópia e esquecer as outras é o dia em que
// uma das quatro portas fica sem freio, e ninguém percebe: a função continua
// respondendo certo, só para de contar.

const RAIZ = join(import.meta.dir, '..', '..')
const FUNCOES = ['cifra', 'video', 'licenca', 'sync']

function regiao(caminho: string): string {
  const texto = readFileSync(join(RAIZ, caminho), 'utf8')
  const inicio = texto.indexOf('// <<< freio-de-mao')
  const fim = texto.indexOf('// >>> freio-de-mao')
  if (inicio < 0 || fim < 0) throw new Error('não achei a marca do freio em ' + caminho)
  return texto.slice(inicio, fim).trim()
}

function arquivo(f: string): string {
  return readFileSync(join(RAIZ, `supabase/functions/${f}/index.ts`), 'utf8')
}

describe('o freio de mão é o mesmo nas quatro funções', () => {
  const mestra = regiao('supabase/functions/_freio.ts')

  test('a cópia-mestra é o freio inteiro, não um pedaço', () => {
    // Este teste existe porque a primeira tentativa copiou 42 bytes: as marcas
    // apareciam também no comentário de cabeçalho, o extrator achou a menção
    // antes do trecho de verdade, e a comparação passou porque as cinco cópias
    // estavam igualmente truncadas. Comparar não basta; é preciso conferir que
    // o que se compara é o freio.
    expect(mestra).toContain('async function passouDoTeto(')
    expect(mestra).toContain('function deOndeVeio(')
    expect(mestra).toContain('function freado(')
    expect(mestra.length).toBeGreaterThan(1500)
  })

  for (const f of FUNCOES) {
    test(`${f} tem o freio, igual à cópia-mestra`, () => {
      expect(regiao(`supabase/functions/${f}/index.ts`)).toBe(mestra)
    })
  }

  test('as quatro chamam o freio pelo endereço E pela conta', () => {
    // pelo endereço para a enxurrada anônima não queimar a chamada ao servidor
    // de contas; pela conta porque endereço se troca e conta não
    for (const f of FUNCOES) {
      const texto = arquivo(f)
      expect(texto).toContain('passouDoTeto(deOndeVeio(req), TETO_ENDERECO.minuto, TETO_ENDERECO.dia)')
      expect(texto).toContain("passouDoTeto('conta:")
    }
  })

  test('cada função conta com o próprio nome, sem repetir', () => {
    // duas funções com o mesmo nome dividiriam o mesmo balde, e o teto de uma
    // derrubaria a outra
    const nomes = FUNCOES.map((f) => /const FUNCAO = '([a-z]+)'/.exec(arquivo(f))?.[1])
    expect(nomes).toEqual(FUNCOES)
    expect(new Set(nomes).size).toBe(FUNCOES.length)
  })

  test('todo teto é um número positivo, e o do dia é maior que o do minuto', () => {
    for (const f of FUNCOES) {
      const texto = arquivo(f)
      for (const qual of ['TETO_CONTA', 'TETO_ENDERECO']) {
        const m = new RegExp(`const ${qual} = \\{ minuto: (\\d+), dia: (\\d+) \\}`).exec(texto)
        expect(m).not.toBe(null)
        const minuto = Number(m?.[1])
        const dia = Number(m?.[2])
        expect(minuto).toBeGreaterThan(0)
        expect(dia).toBeGreaterThan(minuto)
      }
    }
  })

  test('o teto por endereço é mais folgado que o por conta', () => {
    // uma casa de show tem um endereço só e vários aparelhos: apertar o
    // endereço mais que a conta barraria a banda inteira por causa do wi-fi
    for (const f of FUNCOES) {
      const texto = arquivo(f)
      const conta = /const TETO_CONTA = \{ minuto: (\d+), dia: (\d+) \}/.exec(texto)
      const ip = /const TETO_ENDERECO = \{ minuto: (\d+), dia: (\d+) \}/.exec(texto)
      expect(Number(ip?.[1])).toBeGreaterThanOrEqual(Number(conta?.[1]))
      expect(Number(ip?.[2])).toBeGreaterThanOrEqual(Number(conta?.[2]))
    }
  })

  test('o freio falha aberto: banco mudo deixa passar', () => {
    // um problema nosso não pode virar "muitos pedidos" na cara de quem está
    // pagando e só quer abrir o show
    expect(mestra).toContain('if (!res.ok) return false')
    expect(mestra).toMatch(/catch \{\s*return false\s*\}/)
  })
})

describe('nenhuma função devolve erro cru do banco ao cliente', () => {
  // achado S9: "banco respondeu 500" entrega detalhe de infraestrutura a quem
  // sonda, e não diz nada de útil a quem só quer usar o app
  for (const f of FUNCOES) {
    test(f, () => {
      expect(arquivo(f)).not.toContain("e instanceof Error ? e.message : 'falhou'")
    })
  }
})

describe('nenhuma função lê resposta de fora sem teto de bytes', () => {
  // achado S10: res.text() lê o que vier, e uma resposta gigante come a memória
  // da função
  for (const f of FUNCOES) {
    test(f, () => {
      expect(arquivo(f)).not.toMatch(/await res\.text\(\)/)
    })
  }
})
