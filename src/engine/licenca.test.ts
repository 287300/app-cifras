import { describe, expect, test } from 'bun:test'
import {
  aplicarEventoDePagamento,
  diasAteExigirInternet,
  estadoDaLicenca,
  limitesDoPlano,
  planoEfetivo,
  podeCriarShow,
  podeGuardarMusica,
  quantasAcimaDoLimite,
  type Licenca,
} from './licenca.ts'

const DIA = 86_400_000
const AGORA = Date.UTC(2026, 8, 2, 12, 0, 0)
const gratis = (): Licenca => ({ plano: 'gratis', validaAte: 0, conferidaEm: AGORA })
const paga = (validaEmDias: number, conferidaHaDias = 0): Licenca => ({
  plano: 'pago',
  validaAte: AGORA + validaEmDias * DIA,
  conferidaEm: AGORA - conferidaHaDias * DIA,
  renova: true,
})

describe('limites do plano grátis', () => {
  test('o teto é 8 músicas e 1 show', () => {
    expect(limitesDoPlano('gratis')).toEqual({ musicas: 8, shows: 1 })
  })

  test('a oitava música entra e a nona não', () => {
    expect(podeGuardarMusica('gratis', 7)).toBe(true)
    expect(podeGuardarMusica('gratis', 8)).toBe(false)
  })

  test('o primeiro show entra e o segundo não', () => {
    expect(podeCriarShow('gratis', 0)).toBe(true)
    expect(podeCriarShow('gratis', 1)).toBe(false)
  })

  test('quem paga não esbarra em teto nenhum', () => {
    expect(podeGuardarMusica('pago', 5000)).toBe(true)
    expect(podeCriarShow('pago', 300)).toBe(true)
  })

  test('rebaixar não apaga: conta quantas ficam travadas', () => {
    expect(quantasAcimaDoLimite('gratis', 14)).toBe(6)
    expect(quantasAcimaDoLimite('gratis', 3)).toBe(0)
    expect(quantasAcimaDoLimite('pago', 14)).toBe(0)
  })
})

describe('estado da licença', () => {
  test('sem assinatura é grátis, e grátis não expira', () => {
    expect(estadoDaLicenca(gratis(), AGORA)).toBe('gratis')
    expect(estadoDaLicenca(gratis(), AGORA + 900 * DIA)).toBe('gratis')
  })

  test('paga, dentro do prazo e confirmada hoje: ativa', () => {
    expect(estadoDaLicenca(paga(20), AGORA)).toBe('ativa')
  })

  test('paga e sem internet: o 7º dia ainda vale, o 8º não', () => {
    // a tolerância conta a partir da última confirmação do servidor
    expect(estadoDaLicenca(paga(30, 7), AGORA)).toBe('tolerancia')
    expect(estadoDaLicenca(paga(30, 8), AGORA)).toBe('expirada')
  })

  test('o prazo pago é prazo: sem internet ninguém fica pago para sempre', () => {
    // 25 dias sem abrir a internet, ainda dentro do mês pago: não vale mais
    expect(estadoDaLicenca(paga(30, 25), AGORA)).toBe('expirada')
  })

  test('se o servidor confirmou hoje que acabou, acabou (sem tolerância)', () => {
    expect(estadoDaLicenca(paga(-1, 0), AGORA)).toBe('expirada')
  })

  test('em tolerância o app continua tratando como pago', () => {
    expect(planoEfetivo(paga(30, 6), AGORA)).toBe('pago')
    expect(planoEfetivo(paga(30, 8), AGORA)).toBe('gratis')
  })

  test('avisa com quantos dias faltam para precisar de internet', () => {
    expect(diasAteExigirInternet(paga(30, 5), AGORA)).toBe(2)
    expect(diasAteExigirInternet(paga(30, 0), AGORA)).toBe(7)
    expect(diasAteExigirInternet(gratis(), AGORA)).toBe(Infinity)
  })
})

describe('eventos da plataforma de pagamento', () => {
  test('compra libera na hora, por 31 dias', () => {
    const l = aplicarEventoDePagamento(gratis(), 'compra', AGORA)
    expect(l.plano).toBe('pago')
    expect(l.validaAte).toBe(AGORA + 31 * DIA)
    expect(estadoDaLicenca(l, AGORA)).toBe('ativa')
  })

  test('renovação soma ao que ainda faltava, sem encurtar', () => {
    const antes = paga(10)
    const l = aplicarEventoDePagamento(antes, 'renovacao', AGORA)
    expect(l.validaAte).toBe(antes.validaAte + 31 * DIA)
  })

  test('renovação depois do vencimento conta a partir de hoje', () => {
    const l = aplicarEventoDePagamento(paga(-3), 'renovacao', AGORA)
    expect(l.validaAte).toBe(AGORA + 31 * DIA)
  })

  test('atraso no cartão dá 5 dias de fôlego e não corta o show', () => {
    const l = aplicarEventoDePagamento(paga(-1), 'atraso', AGORA)
    expect(l.validaAte).toBe(AGORA + 5 * DIA) // a carência do cartão recusado
    expect(estadoDaLicenca(l, AGORA)).toBe('ativa')
    // Passada a carência, quem manda é a tolerância offline, porque `renova`
    // continua verdadeiro: o cartão pode ter sido aceito na segunda tentativa e
    // o aparelho, sem internet, não tem como saber. Cortar aqui seria o defeito
    // Spec 7 de novo, com outra roupa. O teto continua sendo 7 dias da última
    // confirmação, e uma única conexão põe a verdade do servidor no lugar.
    expect(estadoDaLicenca(l, AGORA + 6 * DIA)).toBe('tolerancia')
    expect(estadoDaLicenca(l, AGORA + 8 * DIA)).toBe('expirada')
  })

  test('atraso não encurta quem já tinha prazo maior', () => {
    const antes = paga(20)
    const l = aplicarEventoDePagamento(antes, 'atraso', AGORA)
    expect(l.validaAte).toBe(antes.validaAte)
  })

  test('cancelar não corta na hora: vale até o fim do que foi pago', () => {
    const l = aplicarEventoDePagamento(paga(12), 'cancelamento', AGORA)
    expect(estadoDaLicenca(l, AGORA)).toBe('ativa')
    expect(l.renova).toBe(false)
    expect(estadoDaLicenca(l, AGORA + 13 * DIA)).toBe('expirada')
  })

  test('quem cancelou acaba na data, sem folga nenhuma', () => {
    // nao ha renovacao para esperar: passou do prazo pago, acabou
    const cancelada: Licenca = { plano: 'pago', validaAte: AGORA - DIA, conferidaEm: AGORA, renova: false }
    expect(estadoDaLicenca(cancelada, AGORA)).toBe('expirada')
    expect(planoEfetivo(cancelada, AGORA)).toBe('gratis')
  })

  test('quem ainda renova nao e rebaixado no palco por prazo velho', () => {
    // O DEFEITO QUE ISTO IMPEDE (achado Spec 7 da revisao de 04/09): o cartao
    // renova todo dia 1o. O musico confere em casa no dia 29, viaja, e toca no
    // sabado dia 2 em modo aviao. O servidor ja esticou o prazo, mas o aparelho
    // ficou com o valor velho e sem internet nunca vai saber. Cortar ali seria
    // rebaixar um assinante em dia no meio do show.
    const conferiuNoDia29: Licenca = {
      plano: 'pago',
      validaAte: AGORA + 2 * DIA, // vence no dia 1o
      conferidaEm: AGORA, // conferiu no dia 29
      renova: true,
    }
    const sabadoDia2 = AGORA + 3 * DIA
    expect(sabadoDia2 > conferiuNoDia29.validaAte).toBe(true) // passou do prazo velho
    expect(estadoDaLicenca(conferiuNoDia29, sabadoDia2)).not.toBe('expirada')
    expect(planoEfetivo(conferiuNoDia29, sabadoDia2)).toBe('pago')
  })

  test('a folga de quem renova tem fim: 7 dias da ultima confirmacao', () => {
    // o outro lado da moeda. Nao existe "pago para sempre por ficar offline":
    // a tolerancia conta da ultima confirmacao, nao do vencimento
    const renovando: Licenca = { plano: 'pago', validaAte: AGORA + DIA, conferidaEm: AGORA, renova: true }
    expect(estadoDaLicenca(renovando, AGORA + 7 * DIA)).toBe('tolerancia')
    expect(estadoDaLicenca(renovando, AGORA + 8 * DIA)).toBe('expirada')
    expect(planoEfetivo(renovando, AGORA + 8 * DIA)).toBe('gratis')
  })

  test('licenca sem o campo renova conta como quem renova', () => {
    // linhas antigas, gravadas antes do campo existir, nao podem cortar ninguem
    const semCampo: Licenca = { plano: 'pago', validaAte: AGORA + DIA, conferidaEm: AGORA }
    const doisDiasDepois = AGORA + 2 * DIA // ja passou do prazo guardado
    expect(estadoDaLicenca(semCampo, doisDiasDepois)).toBe('ativa')
    // a mesma linha, com o cancelamento explicito, corta
    expect(estadoDaLicenca({ ...semCampo, renova: false }, doisDiasDepois)).toBe('expirada')
  })

  test('confirmacao DEPOIS do vencimento nao ganha folga, mesmo renovando', () => {
    // se o servidor confirmou depois da data e ainda mandou esse prazo, nao ha
    // prazo novo esperando do outro lado: o servidor esta vendo a verdade
    const conferidaDepois: Licenca = { plano: 'pago', validaAte: AGORA - DIA, conferidaEm: AGORA, renova: true }
    expect(estadoDaLicenca(conferidaDepois, AGORA)).toBe('expirada')
  })

  test('reembolso corta o acesso pago na hora', () => {
    const l = aplicarEventoDePagamento(paga(20), 'reembolso', AGORA)
    expect(l.plano).toBe('gratis')
    expect(planoEfetivo(l, AGORA)).toBe('gratis')
  })

  test('quem volta a pagar destrava tudo de novo', () => {
    const cortado = aplicarEventoDePagamento(paga(20), 'reembolso', AGORA)
    const voltou = aplicarEventoDePagamento(cortado, 'compra', AGORA + 40 * DIA)
    expect(planoEfetivo(voltou, AGORA + 40 * DIA)).toBe('pago')
    expect(podeGuardarMusica(planoEfetivo(voltou, AGORA + 40 * DIA), 500)).toBe(true)
  })
})
