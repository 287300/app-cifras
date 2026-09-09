import { describe, expect, test } from 'bun:test'
import { noPalco, parseHash, routePath, type Route } from './router.ts'

describe('a regra do palco', () => {
  // A REGRA MAIS CRITICA DO APP. Enquanto ela devolve true, nada de conta,
  // licenca ou sincronizacao pode mexer na tela. Ela morava copiada em
  // src/licenca.ts (noPalco) e src/sync.ts (inPlay), com dois nomes e dois
  // idiomas (achado Standards 3 da revisao de 04/09). Agora e uma so, e tem
  // teste.
  test('tocando uma musica de um show: e palco', () => {
    expect(noPalco('#/play/show3008/0')).toBe(true)
    expect(noPalco('#/play/show3008/7')).toBe(true)
  })

  test('qualquer outra tela nao e palco', () => {
    for (const h of ['', '#', '#/', '#/shows', '#/shows/s1', '#/library', '#/library/m1', '#/edit/m1', '#/add', '#/planb/s1', '#/carga/s1', '#/buscar', '#/more', '#/botao', '#/assinar']) {
      expect(noPalco(h)).toBe(false)
    }
  })

  test('#/play sem show nao e palco: a tela ali e a lista de shows', () => {
    // o startsWith antigo dizia "palco" aqui e congelava o app numa tela que
    // nao e o palco
    expect(parseHash('#/play').name).toBe('shows')
    expect(noPalco('#/play')).toBe(false)
  })

  test('rota parecida nao congela o app por engano', () => {
    // '#/playlist'.startsWith('#/play') era true
    expect(noPalco('#/playlist/qualquer')).toBe(false)
  })

  test('a resposta nunca diverge da tela que o musico esta vendo', () => {
    // e o mesmo parseHash que decide a tela, entao nao ha como as duas
    // respostas discordarem
    for (const h of ['#/play/s1/0', '#/play', '#/playlist', '#/shows', '#/assinar']) {
      expect(noPalco(h)).toBe(parseHash(h).name === 'play')
    }
  })
})

describe('leitura do endereco', () => {
  test('vazio, raiz e shows caem na lista de shows', () => {
    for (const h of ['', '#', '#/', '#/shows']) expect(parseHash(h)).toEqual({ name: 'shows' })
  })

  test('um show, uma musica, uma edicao', () => {
    expect(parseHash('#/shows/s1')).toEqual({ name: 'show', id: 's1' })
    expect(parseHash('#/library/m1')).toEqual({ name: 'song', id: 'm1' })
    expect(parseHash('#/edit/m1')).toEqual({ name: 'edit', id: 'm1' })
  })

  test('a posicao no palco vira numero, e nunca negativa', () => {
    expect(parseHash('#/play/s1/3')).toEqual({ name: 'play', showId: 's1', idx: 3 })
    expect(parseHash('#/play/s1')).toEqual({ name: 'play', showId: 's1', idx: 0 })
    expect(parseHash('#/play/s1/xis')).toEqual({ name: 'play', showId: 's1', idx: 0 })
    expect(parseHash('#/play/s1/-4')).toEqual({ name: 'play', showId: 's1', idx: 0 })
  })

  test('endereco desconhecido nunca deixa a tela em branco', () => {
    expect(parseHash('#/isso-nao-existe')).toEqual({ name: 'shows' })
    expect(parseHash('#/carga')).toEqual({ name: 'shows' })
  })

  test('as telas que aceitam vir de um show guardam de onde vieram', () => {
    expect(parseHash('#/add/s1')).toEqual({ name: 'add', to: 's1' })
    expect(parseHash('#/add')).toEqual({ name: 'add', to: null })
    expect(parseHash('#/buscar/s1')).toEqual({ name: 'buscar', showId: 's1' })
    expect(parseHash('#/planb')).toEqual({ name: 'planb', showId: null })
  })
})

describe('escrever e ler dao a volta completa', () => {
  const rotas: Route[] = [
    { name: 'shows' },
    { name: 'show', id: 's1' },
    { name: 'play', showId: 's1', idx: 2 },
    { name: 'library' },
    { name: 'song', id: 'm1' },
    { name: 'edit', id: 'm1' },
    { name: 'add', to: 's1' },
    { name: 'add', to: null },
    { name: 'planb', showId: 's1' },
    { name: 'planb', showId: null },
    { name: 'carga', showId: 's1' },
    { name: 'buscar', showId: 's1' },
    { name: 'buscar', showId: null },
    { name: 'more' },
    { name: 'botao' },
    { name: 'assinar' },
  ]

  test('toda rota escrita volta igual quando lida', () => {
    for (const r of rotas) expect(parseHash(routePath(r))).toEqual(r)
  })
})
