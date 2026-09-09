import { describe, it, expect } from 'bun:test'
import { parseCifra } from './parse.ts'
import { guessTom, melhorTom } from './guessTom.ts'

// Heurística clássica de cifra brasileira: a música cadencia no tom.
// O último acorde (e, como apoio, o primeiro) aponta a tônica.

describe('adivinhar o tom pelos acordes', () => {
  it('música que termina na tônica maior', () => {
    const song = parseCifra('[Intro] G  D  Em  C\n\nG      D     C\nLetra de exemplo\nC   D    G\nFinal da música')
    expect(guessTom(song)).toBe('G')
  })
  it('música menor', () => {
    const song = parseCifra('Am     F      C     G\nLinha de exemplo\nF   G   Am\nFim')
    expect(guessTom(song)).toBe('Am')
  })
  it('baixo invertido no fim usa o acorde, não o baixo', () => {
    const song = parseCifra('D    A/C#   Bm\nLinha\nG   A   D/F#\nFim')
    expect(guessTom(song)).toBe('D')
  })
  it('quando o texto declara o tom, o declarado vence', () => {
    const song = parseCifra('Tom: Bb\nF   Gm   Bb\nLinha final')
    expect(song.tom).toBe('Bb')
  })
  it('sem acordes: null', () => {
    expect(guessTom(parseCifra('só letra, nada de acordes'))).toBeNull()
  })
})

describe('o tom de uma cifra que chegou da internet', () => {
  // Isto decidia o tom dentro da tela e sem teste nenhum (achado Standards 2 da
  // revisao de 04/09). Errar aqui entrega a musica na altura errada, e o musico
  // so descobre quando abre a boca.
  const corpo = 'Am      F\nqualquer letra\nC       G\noutra linha\nAm'

  it('o tom anunciado pela pagina manda em tudo', () => {
    expect(melhorTom('G', corpo, 'D')).toBe('G')
    expect(melhorTom('Ebm', 'Tom: C\nAm', 'D')).toBe('Ebm')
  })

  it('anuncio que nao e tom nenhum e ignorado, nao repassado', () => {
    // a pagina as vezes manda "Tom: original", "capotraste 2", ou lixo
    expect(melhorTom('original', 'Tom: D\nAm', 'C')).toBe('D')
    expect(melhorTom('', 'Tom: D\nAm', 'C')).toBe('D')
    expect(melhorTom(null, 'Tom: D\nAm', 'C')).toBe('D')
  })

  it('sem anuncio, vale o "Tom:" escrito na propria cifra', () => {
    expect(melhorTom(null, 'Tom: F#m\nAm  C', 'C')).toBe('F#m')
  })

  it('sem anuncio e sem "Tom:", os acordes dao o palpite', () => {
    expect(melhorTom(null, corpo, 'C')).toBe('Am')
  })

  it('nao havendo nada em que se agarrar, fica o que o app ja tinha', () => {
    expect(melhorTom(null, 'so letra, nenhum acorde aqui', 'D')).toBe('D')
    expect(melhorTom(null, '', 'D')).toBe('D')
    // e sem reserva devolve vazio, nunca null nem "undefined" na tela
    expect(melhorTom(null, 'so letra')).toBe('')
  })
})
