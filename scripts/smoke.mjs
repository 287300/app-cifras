// Fumaça de interface: sobe docs/ num servidor local, abre o app num Chromium
// de verdade e percorre o fluxo principal: colar cifra, ler, transpor, tocar
// acorde, persistir (recarregar), criar show e abrir o modo palco.
// Rodar: NODE_PATH=/home/claude/.npm-global/lib/node_modules node scripts/smoke.mjs

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
// import por caminho absoluto: o playwright global não entra no NODE_PATH do ESM
const { chromium } = await import('/home/claude/.npm-global/lib/node_modules/playwright/index.mjs').catch(() => import('playwright'))

const DOCS = new URL('../docs', import.meta.url).pathname
const PORT = 8123
// desde 03/09/2026 a raiz é a página de venda e o app mora aqui
const APP = `http://localhost:${PORT}/app/`

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' }

const server = createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  try {
    const data = await readFile(join(DOCS, path))
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

const FIXTURE = `Tom: G

[Intro]  G  D/F#  Em  C

[Verso 1]
G                D/F#
Quando o dia clareia la fora
Em             C
O vento traz a memoria

[Refrão]
C       D        G    Em
Vem cantar comigo agora
`

// versão comprida para a leitura ter o que rolar (como uma cifra real de 4 minutos)
const FIXTURE_LONGA = FIXTURE + Array.from({ length: 6 }, (_, i) => `\n[Verso ${i + 2}]\nG                D/F#\nMais uma linha de exemplo aqui\nEm             C\nOutra linha para alongar a cifra\nG        D          C\nE o texto segue descendo a tela\n`).join('')

const fails = []
function check(name, cond) {
  if (cond) console.log('  ok:', name)
  else {
    console.log('  FALHOU:', name)
    fails.push(name)
  }
}

await new Promise((r) => server.listen(PORT, r))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 834, height: 1112 }, permissions: ['clipboard-read', 'clipboard-write'] }) // iPad retrato
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => { errors.push(String(e)); if (process.env.VERBO) console.log('!! PAGEERROR:', String(e).slice(0,300)) })
// o YouTube não é alcançável daqui: o player do ensaio falhar no teste é esperado
const externo = (t) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|youtube/i.test(t)
// alguns testes provocam recusa de propósito (código de entrada errado): o
// navegador registra o 403 no console e isso NÃO é defeito do app
let ruidoEsperado = null
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (externo(t) || (ruidoEsperado && ruidoEsperado.test(t))) return
  errors.push(t)
})

// A busca de cifra e a de vídeo vão com o CRACHÁ da pessoa (revisão de
// 04/09/2026), não com a chave pública do app. Vários blocos abaixo exercitam
// essas buscas e precisam de uma conta gravada no aparelho; outros precisam
// justamente do contrário. Estes dois ajudantes trocam de estado sem passar
// pela tela, que é o que os blocos de login testam por conta própria.
const seguraConta = async (alvo) => {
  await alvo.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    await new Promise((res) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put({ key: 'conta', value: { email: 'eder@gmail.com', userId: 'user-eder', accessToken: 'crachá-da-porta', refreshToken: 'renova-da-porta', expiraEm: Date.now() + 3600000 } })
      // com conta, os limites do grátis passam a valer; estes blocos carregam
      // repertório de sobra e não são sobre plano, então a licença vai paga
      t.objectStore('kv').put({ key: 'licenca', value: { plano: 'pago', validaAte: Date.now() + 30 * 86400000, conferidaEm: Date.now(), renova: true, userId: 'user-eder', jaFoiPagante: true } })
      t.oncomplete = res
    })
    db.close()
  })
}
const largaConta = async (alvo) => {
  await alvo.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    await new Promise((res) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').delete('conta')
      t.objectStore('kv').delete('licenca')
      t.objectStore('kv').delete('dono') // senão o próximo login cai na pergunta de troca de dono
      t.oncomplete = res
    })
    db.close()
  })
}

try {
  // ---------- a porta: aparelho novo cria conta antes de ver o app ----------
  // Decisão comercial do Eder: sem conta, sem app. Quem chega aqui já leu a
  // página de venda; esta tela só pede o e-mail e sai da frente.
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url()
    if (url.includes('/otp')) return route.fulfill({ json: {} })
    if (url.includes('/verify')) {
      return route.fulfill({
        json: {
          access_token: 'crachá-da-porta',
          refresh_token: 'renova-da-porta',
          expires_in: 3600,
          user: { id: 'user-eder', email: 'eder@gmail.com' },
        },
      })
    }
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ json: { id: 'user-eder', email: 'eder@gmail.com' } })
  })

  await page.goto(APP)
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 12000 })
  check('PORTA: aparelho novo cai no cadastro, não na tela de Shows', (await page.locator('.tabbar').count()) === 0)
  check('PORTA: a tela diz o que fazer', /Crie sua conta/.test(await page.textContent('.content')))
  check('PORTA: promete de graça e sem cartão', /Não pede cartão/.test(await page.textContent('.content')))
  check('PORTA: nenhum campo de senha existe na porta', (await page.locator('input[type="password"]').count()) === 0)
  check('PORTA: quem já usa o app tem saída pelo backup', (await page.locator('button:has-text("Restaurar um backup")').count()) === 1)

  await page.fill('input[placeholder="seu@email.com"]', 'eder@gmail.com')
  await page.click('button:has-text("Entrar com meu e-mail")')
  await page.waitForSelector('.sheet input[placeholder="000000"]', { timeout: 8000 })
  await page.fill('.sheet input[placeholder="000000"]', '123456')
  await page.waitForSelector('.sheet h2:has-text("Pronto")', { timeout: 8000 })
  await page.click('.sheet button:has-text("Ok")')
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  check('PORTA: entrando com o e-mail, a porta abre na hora', (await page.locator('.tabbar').count()) === 1)

  // a barra de abas pode aparecer um quadro antes do texto; espera o botão
  await page.waitForSelector('.tabbar button:has-text("Shows")', { timeout: 8000 })
  check('app abre na tela de Shows', (await page.locator('.tabbar button:has-text("Shows")').count()) === 1)

  // adicionar música pela biblioteca, colando com o cabeçalho do botão de importar
  await page.click('.tabbar button:has-text("Biblioteca")')
  await page.click('button[aria-label="Adicionar música"]')
  await page.fill('textarea', 'Música: Minha Cancao\nArtista: Exemplo\n\n' + FIXTURE_LONGA)
  check('colagem preenche o nome sozinho', (await page.inputValue('input[placeholder="Nome da música"]')) === 'Minha Cancao')
  check('colagem preenche o artista sozinho', (await page.inputValue('input[placeholder^="Artista"]')) === 'Exemplo')
  check('cabeçalho sai do corpo da cifra', !(await page.inputValue('textarea')).includes('Música:'))
  check('tom detectado da colagem', (await page.inputValue('select')) === 'G')
  await page.click('button:has-text("Salvar música")')
  await page.waitForSelector('.readerbar', { timeout: 5000 })
  check('leitura abre com o tom no topo', (await page.textContent('.readerbar .badge')) === 'G')
  check('acordes destacados na cifra', (await page.locator('.cifra .chord').count()) >= 6)

  // transposição em 1 toque
  await page.click('button[aria-label="Subir meio tom"]')
  check('subir meio tom: G vira Ab', (await page.textContent('.readerbar .badge')) === 'Ab')
  const firstChord = await page.textContent('.cifra .chord >> nth=0')
  check('primeiro acorde transposto para Ab', firstChord === 'Ab')
  await page.click('button[aria-label="Descer meio tom"]')

  // desenho do acorde (violão + teclado)
  await page.click('.cifra .chord >> nth=1') // D/F#
  await page.waitForSelector('.sheet')
  check('desenho do violão aparece', await page.isVisible('.diagram .lbl:has-text("Violão")'))
  check('desenho do teclado aparece', await page.isVisible('.diagram .lbl:has-text("Teclado")'))
  check('baixo do acorde indicado', (await page.textContent('.notesline')).includes('baixo'))
  await page.click('.sheetwrap .backdrop')

  // rolagem automática liga, DESCE DE VERDADE e desliga
  await page.click('.scrollflag')
  check('rolagem automática liga', (await page.textContent('.scrollflag')).includes('rolando'))
  await page.waitForTimeout(1400)
  const scrolled = await page.evaluate(() => document.querySelector('.reader .content').scrollTop)
  check('rolagem realmente desce a tela (+' + Math.round(scrolled) + 'px)', scrolled > 8)

  // velocidade: dois toques no ＋ mostram o multiplicador e ficam salvos na música
  await page.click('button[aria-label="Rolagem mais rápida"]')
  await page.click('button[aria-label="Rolagem mais rápida"]')
  check('velocidade sobe e aparece no botão', (await page.textContent('.scrollflag')).includes('1,3×'))
  const savedSeconds = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const songs = await new Promise((res, rej) => { const t = db.transaction('songs', 'readonly'); const r = t.objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    return songs[0].scrollSeconds
  })
  check('velocidade nova gravada na música (' + savedSeconds + 's)', savedSeconds < 180)
  await page.click('button[aria-label="Rolagem mais devagar"]')
  await page.click('.scrollflag')

  // persistência: recarrega e a música continua
  await page.reload()
  await page.waitForSelector('.readerbar') // volta para a leitura da mesma música
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('.tabbar')
  await page.waitForSelector('.card', { timeout: 5000 })
  check('música persistida após recarregar', await page.isVisible('.card .title:has-text("Minha Cancao")'))

  // ---------- a ressalva da porta: repertório no aparelho vale mais que cadastro ----------
  // Com uma música gravada aqui, sair da conta NÃO pode devolver a barreira.
  // O app é usado no palco, muitas vezes em modo avião: trancar um músico fora
  // do próprio repertório seria o pior defeito possível neste produto.
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  await page.click('button:has-text("Sair da conta")')
  await page.waitForSelector('.confirmbox', { timeout: 5000 })
  await page.click('.confirmbox .btn.danger')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  check('PORTA: com música no aparelho, sair da conta não devolve a barreira', (await page.locator('.tabbar').count()) === 1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  check('PORTA: e reabrindo o app deslogado também não', (await page.locator('.card, .empty, .tabbar').count()) > 0)
  // apaga o dono adotado na porta: senão o login mais adiante cai na pergunta de troca
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete('dono'); t.oncomplete = res })
    db.close()
  })
  await page.unroute('**/auth/v1/**')
  await page.goto(APP)
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await page.click('.tabbar button:has-text("Biblioteca")')
  await page.waitForSelector('.card', { timeout: 8000 })

  // show com setlist
  await page.click('.tabbar button:has-text("Shows")')
  await page.click('button[aria-label="Novo show"]')
  await page.fill('input[placeholder^="Nome do show"]', 'Show de teste')
  await page.click('button:has-text("Criar show")')
  await page.waitForSelector('button:has-text("＋ Música")')
  await page.click('button:has-text("＋ Música")')
  await page.click('.sheet .card')
  await page.click('button:has-text("Concluir")')
  await page.waitForSelector('.setitem')
  check('música entrou na setlist', await page.isVisible('.setitem .title:has-text("Minha Cancao")'))
  await page.click('button:has-text("Tocar o show")')
  await page.waitForSelector('.readerbar')
  check('modo palco abre pelo show', (await page.textContent('.readerbar .t .meta')).includes('1 de 1'))

  // service worker ficou no controle (offline garantido)
  await page.waitForTimeout(600)
  const swActive = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return !!(reg && (reg.active || reg.waiting))
  })
  check('service worker registrado (offline)', swActive)

  // backup: exportar gera arquivo; importar o mesmo arquivo não duplica nada
  await page.click('button[aria-label="Sair"]') // sai do palco para a tela do show
  await page.waitForSelector('button:has-text("Tocar o show")')
  await page.click('button[aria-label="Voltar"]')
  await page.waitForSelector('.tabbar')
  await page.click('.tabbar button:has-text("Mais")')
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exportar backup")')])
  const backupPath = await download.path()
  check('backup exportado como arquivo', backupPath !== null && download.suggestedFilename().startsWith('cifras-backup-'))
  await page.setInputFiles('input[type="file"]', backupPath)
  await page.waitForSelector('.sheet')
  const importMsg = await page.textContent('.sheet p')
  check('importar o próprio backup não duplica (novas: 0)', importMsg.includes('Novas: 0'))
  await page.click('.sheet button:has-text("Ok")')

  // assistente de carga: show importado por esqueleto, cifra entra pela busca no app
  // (o ajudante do Supabase é simulado aqui; a versão real é testada no ar)
  const FAKE_FETCHED = {
    title: 'Natália',
    artist: 'Legião Urbana',
    tom: 'Am',
    body: 'Tom: Am\n\n[Intro] Am  G  F  E\n\nAm            G\nLinha de exemplo um\nF             E\nLinha de exemplo dois\n',
    sourceUrl: 'https://exemplo.test/natalia',
    host: 'cifraclub.com.br',
    weak: false,
  }
  await page.route('**/functions/v1/cifra*', (route) => {
    const url = route.request().url()
    if (url.includes('op=search')) {
      route.fulfill({ json: { hits: [{ title: 'Natália · Legião Urbana', url: 'https://exemplo.test/natalia', host: 'cifraclub.com.br' }] } })
    } else {
      route.fulfill({ json: FAKE_FETCHED })
    }
  })
  await page.setInputFiles('input[type="file"]', new URL('../show-30-08.json', import.meta.url).pathname)
  await page.waitForSelector('.sheet')
  await page.click('.sheet button:has-text("Ok")')
  await page.click('.tabbar button:has-text("Shows")')
  await page.click('.card:has-text("Show 30/08")')
  await page.waitForSelector('button:has-text("Assistente de carga")')
  check('show com esqueletos oferece o assistente', await page.isVisible('text=faltam 13 cifras'))

  // BUSCA COM CRACHÁ (revisão de 04/09/2026). A busca vai com o crachá DA
  // PESSOA, não com a chave pública do app, que mora dentro do app.js e é um
  // arquivo aberto na internet. Deslogado, o app pede a conta em vez de chamar
  // o buscador; o repertório que já está no aparelho continua intocado.
  await page.click('button:has-text("Assistente de carga")')
  await page.waitForSelector('.banner:has-text("Entre com o seu e-mail")', { timeout: 8000 })
  check('BUSCA: deslogada, a busca pede a conta em vez de chamar o buscador', true)

  // volta a ter conta (o mesmo e-mail da porta) e o assistente funciona
  await seguraConta(page)
  await page.evaluate(() => { location.hash = '#/shows' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar button:has-text("Shows")', { timeout: 8000 })
  await page.click('.card:has-text("Show 30/08")')
  await page.waitForSelector('button:has-text("Assistente de carga")')
  await page.click('button:has-text("Assistente de carga")')
  await page.waitForSelector('.card:has-text("Natália · Legião Urbana")')
  check('BUSCA: com a conta de volta, o assistente busca normalmente', true)
  check('busca no app lista resultados sozinha', true)
  await page.click('.card:has-text("Natália · Legião Urbana")')
  await page.waitForSelector('button:has-text("Usar esta")')
  check('prévia mostra o tom e a fonte', await page.isVisible('text=fonte: cifraclub.com.br'))
  await page.click('button:has-text("Usar esta")')
  await page.waitForSelector('text=1 de 13 músicas com cifra')
  check('salvar pela busca avança para a próxima', await page.isVisible("text=L'Avventura"))

  // caminho manual continua vivo (colar e salvar) com trava de colagem repetida
  const FAKE = 'Música: LAvventura\nArtista: Legião Urbana\n\nTom: G\n\n[Intro] G  D  C\n\nG            D\nLinha de exemplo um\nC            D\nLinha de exemplo dois\n'
  await page.evaluate((t) => navigator.clipboard.writeText(t), FAKE)
  await page.click('button:has-text("Colar e salvar")')
  await page.waitForSelector('text=2 de 13 músicas com cifra')
  check('caminho manual salva e avança', await page.isVisible('text=Soul Parsifal'))
  await page.click('button:has-text("Colar e salvar")')
  await page.waitForSelector('.banner:has-text("mesma cifra")')
  check('assistente barra colagem repetida', true)
  // rodapé só diz para onde vai; o nome da próxima NÃO aparece na tela
  await page.evaluate(() => { location.hash = '#/play/show3008/0' })
  await page.waitForSelector('.playerfoot .nextbtn')
  const rodape = await page.textContent('.playerfoot .nextbtn')
  check('botão diz apenas "próxima música"', rodape.toLowerCase().includes('próxima música'))
  check('o nome da próxima música não aparece na tela', !rodape.includes("L'Avventura") && !(await page.locator('.playerfoot').innerText()).includes("L'Avventura"))
  check('botão da próxima não usa o destaque laranja', !(await page.getAttribute('.playerfoot .nextbtn', 'class')).includes('primary'))
  check('música tocando aparece em destaque', await page.isVisible('.readerbar .t .title.nowplaying'))
  const corpoTitulo = await page.evaluate(() => {
    const t = document.querySelector('.readerbar .t .title.nowplaying')
    const proxima = document.querySelector('.playerfoot .nextbtn .nextlabel')
    return { titulo: parseFloat(getComputedStyle(t).fontSize), rodape: parseFloat(getComputedStyle(proxima).fontSize) }
  })
  check('o nome da música tocando é bem maior que o texto do rodapé (' + corpoTitulo.titulo + 'px x ' + corpoTitulo.rodape + 'px)', corpoTitulo.titulo >= corpoTitulo.rodape * 1.6)
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/palco.png' })
  await page.click('.playerfoot .nextbtn')
  await page.waitForSelector('.readerbar .t .meta:has-text("2 de 13")')
  check('botão troca de música na hora', true)
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('button:has-text("Tocar o show")')

  // excluir música direto da biblioteca, com confirmação
  await page.evaluate(() => { location.hash = '#/library' })
  await page.waitForSelector('.card:has-text("Minha Cancao")')
  await page.click('.card:has-text("Minha Cancao") button[aria-label="Excluir música"]')
  await page.waitForSelector('.confirmbox')
  await page.click('.confirmbox button:has-text("Excluir")')
  await page.waitForTimeout(400)
  check('música excluída some da biblioteca', !(await page.isVisible('.card .title:has-text("Minha Cancao")')))

  await page.evaluate(() => { location.hash = '#/shows' })
  await page.waitForSelector('.tabbar')

  // ---------- sincronização entre aparelhos (nuvem simulada, 1 linha como no Supabase) ----------
  const cloud = { row: null, pairs: {} }
  const syncMock = (route) => {
    const body = route.request().postDataJSON()
    if (body.op === 'pair-create') {
      cloud.pairs[body.pairId] = body.payload
      route.fulfill({ json: { ok: true, expiresInMin: 10 } })
    } else if (body.op === 'pair-claim') {
      const payload = cloud.pairs[body.pairId]
      delete cloud.pairs[body.pairId]
      if (payload) route.fulfill({ json: { payload } })
      else route.fulfill({ status: 404, json: { error: 'código não encontrado ou já usado' } })
    } else if (body.op === 'pull') {
      route.fulfill({
        json: cloud.row
          ? { payload: cloud.row.payload, updatedAt: cloud.row.updatedAt, device: cloud.row.device }
          : { empty: true },
      })
    } else if (body.op === 'push') {
      if (cloud.row && Math.abs(cloud.row.updatedAt - (body.baseUpdatedAt || 0)) > 1500) {
        route.fulfill({
          status: 409,
          json: { conflict: true, payload: cloud.row.payload, updatedAt: cloud.row.updatedAt, device: cloud.row.device },
        })
      } else {
        cloud.row = { payload: body.payload, updatedAt: Date.now(), device: body.device }
        route.fulfill({ json: { ok: true, updatedAt: cloud.row.updatedAt } })
      }
    } else {
      route.fulfill({ status: 400, json: { error: 'op?' } })
    }
  }
  let chamadasNaNuvem = 0
  const syncContado = (route) => {
    chamadasNaNuvem++
    return syncMock(route)
  }
  await page.route('**/functions/v1/sync*', syncContado)

  // ---------- sincronizar é recurso de quem assina (ticket 17) ----------
  // Conta e licença entram direto no banco do aparelho, do mesmo jeito que um
  // iPad que abriu o app em modo avião: o que o teste quer medir é o estado,
  // não o caminho até ele.
  const marcaConta = (alvo, plano) => alvo.evaluate(async (plano) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras', 1); r.onupgradeneeded = () => { const d = r.result; for (const n of ['songs','shows','kv']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: n === 'kv' ? 'key' : 'id' }) }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    await new Promise((res) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put({ key: 'conta', value: { email: 'assinante@teste.com', userId: 'user-sync', accessToken: 'x', refreshToken: 'y', expiraEm: Date.now() + 3600000 } })
      t.objectStore('kv').put({ key: 'licenca', value: { plano, validaAte: plano === 'pago' ? Date.now() + 30 * 86400000 : 0, conferidaEm: Date.now(), renova: true, userId: 'user-sync', jaFoiPagante: plano === 'pago' } })
      t.oncomplete = res
    })
    db.close()
  }, plano)
  const marcaComoPagante = (alvo) => marcaConta(alvo, 'pago')
  const recarrega = async (alvo) => {
    await alvo.reload({ waitUntil: 'domcontentloaded' })
    await alvo.waitForSelector('.tabbar', { timeout: 8000 })
    await alvo.evaluate(() => { location.hash = '#/more' })
    await alvo.waitForSelector('.content', { timeout: 8000 })
    await alvo.waitForTimeout(400)
  }

  // desfaz a conta que o assistente de carga precisou ter: daqui para a frente
  // o percurso é o de um aparelho deslogado de novo
  await largaConta(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })

  // sem conta: o motivo é a conta, não o dinheiro. Mandar assinar quem nem
  // entrou ainda é pedir para pagar por algo que a pessoa não tem como usar
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('.content')
  const cartaoSemConta = await page.textContent('.content')
  check(
    'SYNC PAGO: sem conta, o cartão pede a conta e não oferece ligar',
    /entrar com o seu e-mail/i.test(cartaoSemConta) && (await page.locator('button:has-text("Ativar sincronização")').count()) === 0
  )

  // com conta, no grátis: aí sim o motivo é o plano, com a compra ao lado
  let planoDoServidor = 'gratis'
  await page.route('**/auth/v1/**', (route) => route.fulfill({ json: { id: 'user-sync', email: 'assinante@teste.com' } }))
  await page.route('**/functions/v1/licenca*', (route) =>
    route.fulfill({ json: { plano: planoDoServidor, restamMs: planoDoServidor === 'pago' ? 30 * 86400000 : 0, renova: true } })
  )
  await marcaConta(page, 'gratis')
  await recarrega(page)
  const noGratis = await page.textContent('.content')
  check(
    'SYNC PAGO: com conta no grátis, o cartão diz que é da assinatura',
    /recurso da assinatura/i.test(noGratis) && (await page.locator('button:has-text("Ativar sincronização")').count()) === 0
  )
  check('SYNC PAGO: e o caminho da compra fica ao lado da explicação', (await page.locator('button:has-text("Quero assinar")').count()) === 1)
  check('SYNC PAGO: a frase avisa que nada foi perdido', /continuam inteiras/i.test(noGratis))
  check('SYNC PAGO: no grátis o app nem tenta falar com a nuvem', chamadasNaNuvem === 0)
  await page.click('button:has-text("Quero assinar")')
  await page.waitForSelector('.sheet:has-text("Assinando, isso some")', { timeout: 8000 })
  check('SYNC PAGO: o botão abre a folha da assinatura com o preço', (await page.textContent('.sheet')).includes('29,90'))
  await page.click('.sheetwrap .backdrop')

  // assina: a nuvem passa a valer
  planoDoServidor = 'pago'
  await marcaConta(page, 'pago')
  await recarrega(page)

  // aparelho A: ativa sem digitar senha nenhuma e manda a biblioteca para a nuvem
  await page.waitForSelector('button:has-text("Ativar sincronização")')
  check('SYNC: não pede mais palavra-chave', (await page.locator('input[placeholder^="Palavra-chave"]').count()) === 0)
  await page.click('button:has-text("Ativar sincronização")')
  await page.waitForSelector('.sheet:has-text("Sincronização ligada")', { timeout: 8000 })
  await page.click('.sheetwrap .backdrop')
  check('SYNC A: ativa sozinha e faz o primeiro envio cifrado', cloud.row !== null && cloud.row.payload.includes('.'))
  check('SYNC A: nada de cifra legível na nuvem', !String(cloud.row.payload).includes('Natália'))

  // A gera o código de 6 números para o outro aparelho
  await page.click('button:has-text("Conectar outro aparelho")')
  await page.waitForSelector('.paircode', { timeout: 8000 })
  await page.waitForFunction(() => /\d{3} \d{3}/.test(document.querySelector('.paircode')?.textContent || ''), { timeout: 8000 })
  const code = (await page.textContent('.paircode')).replace(/\D/g, '')
  check('SYNC: código de 6 números gerado (' + code.length + ' dígitos)', code.length === 6)
  await page.click('.sheetwrap .backdrop')

  // aparelho B: outro navegador zerado, digita o código e entra no mesmo conjunto
  const ctxB = await browser.newContext({ viewport: { width: 834, height: 1112 } })
  const pageB = await ctxB.newPage()
  // Sincronizar é recurso de quem assina: este aparelho entra com a mesma
  // conta e uma assinatura válida, que é o caminho de verdade de um iPad novo.
  await pageB.route('**/auth/v1/**', (route) => route.fulfill({ json: { id: 'user-sync', email: 'assinante@teste.com' } }))
  await pageB.route('**/functions/v1/licenca*', (route) => route.fulfill({ json: { plano: 'pago', restamMs: 30 * 86400000, renova: true } }))
  pageB.on('pageerror', (e) => errors.push('B: ' + String(e)))
  await pageB.route('**/functions/v1/sync*', syncMock)
  await pageB.goto(APP)
  await marcaComoPagante(pageB)
  await pageB.reload({ waitUntil: 'domcontentloaded' })
  await pageB.waitForSelector('.tabbar', { timeout: 8000 })
  await pageB.waitForTimeout(2000) // o service worker assume e recarrega a página 1 vez
  await pageB.waitForSelector('.tabbar', { timeout: 8000 })
  await pageB.evaluate(() => { location.hash = '#/more' })
  await pageB.waitForSelector('button:has-text("Tenho um código")')
  const classeCodigo = await pageB.getAttribute('button:has-text("Tenho um código")', 'class')
  check('SYNC: em aparelho vazio o botão do código é o de destaque', classeCodigo.includes('primary'))
  await pageB.click('button:has-text("Tenho um código")')
  await pageB.fill('.sheet input[inputmode="numeric"]', code)
  await pageB.click('.sheet button:has-text("Conectar")')
  await pageB.waitForSelector('.sheet:has-text("Aparelhos conectados")', { timeout: 10000 })
  await pageB.click('.sheetwrap .backdrop')
  await pageB.evaluate(() => { location.hash = '#/more' })
  await pageB.waitForSelector('button:has-text("Sincronizar agora")', { timeout: 8000 })
  check(
    'SYNC: com a sincronização ligada ainda dá para entrar no conjunto de outro aparelho',
    (await pageB.locator('button:has-text("Tenho um código")').count()) === 1
  )
  await pageB.evaluate(() => { location.hash = '#/library' })
  await pageB.waitForSelector('.card:has-text("Aloha")', { timeout: 8000 })
  const cardsB = await pageB.evaluate(() => document.querySelectorAll('.card').length)
  check('SYNC B: aparelho novo recebe a biblioteca inteira (' + cardsB + ' músicas)', cardsB >= 10)

  // B cria uma música; A puxa com "Sincronizar agora" e ela aparece
  await pageB.click('button[aria-label="Adicionar música"]')
  await pageB.fill('textarea', 'Música: Vinda Do Ipad\nArtista: Teste\n\n[Intro] G  D  C\nG      D\nLinha exemplo\n')
  await pageB.click('button:has-text("Salvar música")')
  await pageB.waitForSelector('.readerbar', { timeout: 5000 })
  await pageB.waitForTimeout(4600) // debounce do envio automático
  const subiu = cloud.row && cloud.row.updatedAt
  check('SYNC B: mudança sobe sozinha depois de salvar', !!subiu)

  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sincronizar agora")')
  await page.click('button:has-text("Sincronizar agora")')
  await page.waitForTimeout(1200)
  await page.evaluate(() => { location.hash = '#/library' })
  await page.waitForSelector('.card:has-text("Vinda Do Ipad")', { timeout: 8000 })
  check('SYNC A: recebe na hora a música criada no outro aparelho', true)

  // B sai da frente com envio pendente: tem de subir na hora, sem esperar os 4 s
  const antesFlush = cloud.row.updatedAt
  await pageB.evaluate(() => { location.hash = '#/library' })
  await pageB.click('button[aria-label="Adicionar música"]')
  await pageB.fill('textarea', 'Música: Saiu Da Frente\nArtista: Teste\n\n[Intro] C  G\nC     G\nOutra linha\n')
  await pageB.click('button:has-text("Salvar música")')
  await pageB.waitForSelector('.readerbar', { timeout: 5000 })
  const t0 = Date.now()
  await pageB.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  for (let i = 0; i < 80 && cloud.row.updatedAt === antesFlush; i++) await pageB.waitForTimeout(100)
  const levou = Date.now() - t0
  // o que importa é ter batido o debounce de 4 s do envio automático
  check('SYNC: sair do app manda na hora o que estava pendente (' + levou + 'ms)', cloud.row.updatedAt !== antesFlush && levou < 4000)

  // A fica parada na tela e recebe sozinha, sem ninguém tocar em nada (ronda)
  await page.goto(APP + `?ronda=1200#/library`)
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await pageB.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await pageB.evaluate(() => { location.hash = '#/library' })
  await pageB.click('button[aria-label="Adicionar música"]')
  await pageB.fill('textarea', 'Música: Chegou Sozinha\nArtista: Teste\n\n[Intro] D  A\nD     A\nLinha da ronda\n')
  await pageB.click('button:has-text("Salvar música")')
  await pageB.waitForSelector('.readerbar', { timeout: 5000 })
  await pageB.waitForTimeout(4600) // envio automático de B
  await page.waitForSelector('.card:has-text("Chegou Sozinha")', { timeout: 12000 })
  check('SYNC: app aberto e parado busca a nuvem sozinho (ronda)', true)

  await ctxB.close()

  // ---------- parar de pagar não apaga nada, e voltar não pede pareamento ----------
  const contaMusicas = () => page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('cifras', 1); r.onsuccess = () => res(r.result) })
    const n = await new Promise((res) => { const q = db.transaction('songs').objectStore('songs').count(); q.onsuccess = () => res(q.result) })
    db.close()
    return n
  })
  const chaveGuardada = () => page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('cifras', 1); r.onsuccess = () => res(r.result) })
    const row = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('sync'); q.onsuccess = () => res(q.result) })
    db.close()
    return !!(row?.value?.enabled && row.value.rawKey)
  })

  const musicasAntes = await contaMusicas()
  planoDoServidor = 'gratis'
  await marcaConta(page, 'gratis')
  await recarrega(page)
  const vencida = await page.textContent('.content')
  check('SYNC PAGO: assinatura vencida explica em vez de dar erro', /recurso da assinatura/i.test(vencida) && !/Falhou/i.test(vencida))
  check('SYNC PAGO: e diz que continua ligada, só parada', /continua ligada neste aparelho/i.test(vencida))
  check('SYNC PAGO: nenhuma música foi apagada (' + musicasAntes + ')', (await contaMusicas()) === musicasAntes && musicasAntes > 10)
  check('SYNC PAGO: a chave do conjunto continua guardada no aparelho', await chaveGuardada())
  const paradaEm = chamadasNaNuvem
  await page.waitForTimeout(1800) // duas rondas de sobra
  check('SYNC PAGO: parada de verdade, nem a ronda bate na nuvem', chamadasNaNuvem === paradaEm)

  planoDoServidor = 'pago'
  await marcaConta(page, 'pago')
  await recarrega(page)
  for (let i = 0; i < 60 && chamadasNaNuvem === paradaEm; i++) await page.waitForTimeout(100)
  check('SYNC PAGO: voltando a pagar, ela volta sozinha sem parear de novo', chamadasNaNuvem > paradaEm)
  check(
    'SYNC PAGO: e o cartão volta a oferecer conectar outro aparelho',
    (await page.locator('button:has-text("Conectar outro aparelho")').count()) === 1
  )

  // devolve o aparelho ao estado em que os próximos blocos esperam encontrá-lo:
  // sem conta gravada, para o teste de entrar pelo e-mail começar do zero
  await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('cifras', 1); r.onsuccess = () => res(r.result) })
    await new Promise((res) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').delete('conta')
      t.objectStore('kv').delete('licenca')
      t.objectStore('kv').delete('dono') // senão o próximo login cai na pergunta de troca de dono
      t.oncomplete = res
    })
    db.close()
  })
  await page.unroute('**/functions/v1/sync*')
  await page.unroute('**/functions/v1/licenca*')
  await page.unroute('**/auth/v1/**')
  // a busca de vídeo, logo abaixo, também vai com o crachá da pessoa
  await seguraConta(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })

  // ---------- ordem do show pelos botões, teclado no palco e vídeo ----------
  await page.evaluate(() => { location.hash = '#/shows/show3008' })
  await page.waitForSelector('.setitem')
  const primeiro = await page.textContent('.setitem >> nth=0 >> .title')
  const segundo = await page.textContent('.setitem >> nth=1 >> .title')
  await page.click('.setitem >> nth=1 >> button[aria-label="Subir na ordem"]')
  await page.waitForTimeout(500)
  check('ORDEM: botão sobe a música na setlist', (await page.textContent('.setitem >> nth=0 >> .title')) === segundo)
  await page.click('.setitem >> nth=0 >> button[aria-label="Descer na ordem"]')
  await page.waitForTimeout(500)
  check('ORDEM: botão desce e volta ao original', (await page.textContent('.setitem >> nth=0 >> .title')) === primeiro)
  check('ORDEM: primeira música não pode subir', await page.isDisabled('.setitem >> nth=0 >> button[aria-label="Subir na ordem"]'))

  // ARRASTO: segurar a música e levar até a terceira posição
  const nomes = () => page.locator('.setitem .title').allTextContents()
  const antesDoArrasto = await nomes()
  const linha0 = await page.locator('.setitem').nth(0).boundingBox()
  const linha2 = await page.locator('.setitem').nth(2).boundingBox()
  const xPega = linha0.x + 120 // sobre o nome da música, longe dos botões ↑ ↓ −
  await page.mouse.move(xPega, linha0.y + linha0.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(250) // ainda não deu o tempo de segurar
  check('ARRASTO: antes de segurar o tempo todo, a música não é levantada', (await page.locator('.setitem.dragging').count()) === 0)
  await page.waitForTimeout(450) // agora sim
  check('ARRASTO: segurar levanta a música', (await page.locator('.setitem.dragging').count()) === 1)
  await page.mouse.move(xPega, linha2.y + linha2.height * 0.8, { steps: 12 }) // solta sobre a metade de baixo da 3ª linha
  await page.waitForTimeout(200)
  check('ARRASTO: os números acompanham o dedo', (await page.textContent('.setitem.dragging .pos')) === '3')
  await page.mouse.up()
  await page.waitForTimeout(700)
  const depoisDoArrasto = await nomes()
  check('ARRASTO: a música parou na 3ª posição', depoisDoArrasto[2] === antesDoArrasto[0] && depoisDoArrasto[0] === antesDoArrasto[1])
  check('ARRASTO: soltar não abre a música por engano', (await page.locator('.setitem').count()) > 0 && (await page.locator('.readerbar').count()) === 0)

  // devolve a ordem original e confere que o toque curto continua abrindo a música
  await page.click('.setitem >> nth=2 >> button[aria-label="Subir na ordem"]')
  await page.waitForTimeout(400)
  await page.click('.setitem >> nth=1 >> button[aria-label="Subir na ordem"]')
  await page.waitForTimeout(400)
  check('ARRASTO: ordem original restaurada pelos botões', (await nomes())[0] === antesDoArrasto[0])
  const linhaToque = await page.locator('.setitem').nth(0).boundingBox()
  await page.mouse.click(linhaToque.x + 120, linhaToque.y + linhaToque.height / 2)
  await page.waitForSelector('.readerbar', { timeout: 5000 })
  check('ARRASTO: toque curto continua abrindo a música', true)
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('.setitem', { timeout: 5000 })

  // teclado e pedal: espaço liga e pausa, setas trocam de música
  // (numa cifra comprida, que é onde a rolagem tem o que rolar)
  await page.evaluate(() => { location.hash = '#/add/show3008' })
  await page.waitForSelector('textarea')
  await page.fill('textarea', 'Música: Cifra Comprida\nArtista: Teste\n\n' + FIXTURE_LONGA)
  await page.click('button:has-text("Salvar música")')
  await page.waitForTimeout(800)
  await page.click('button[aria-label="Sair"]').catch(() => undefined)
  await page.evaluate(() => { location.hash = '#/shows/show3008' })
  await page.waitForSelector('.setitem:has-text("Cifra Comprida")', { timeout: 8000 })
  const ultima = (await page.locator('.setitem').count()) - 1
  await page.evaluate((i) => { location.hash = '#/play/show3008/' + i }, ultima)
  await page.waitForSelector('.readerbar')
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  check('TECLADO: espaço liga a rolagem', (await page.textContent('.scrollflag')).includes('rolando'))
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  check('TECLADO: espaço pausa a rolagem', !(await page.textContent('.scrollflag')).includes('rolando'))
  const antes = await page.textContent('.readerbar .t .meta')
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(400)
  check('PEDAL: seta esquerda volta uma música', (await page.textContent('.readerbar .t .meta')) !== antes)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  check('PEDAL: seta direita avança de volta', (await page.textContent('.readerbar .t .meta')) === antes)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(300)
  check('TECLADO: seta para cima acelera a rolagem', (await page.textContent('.scrollflag')).includes('×'))

  // vídeo do YouTube ao lado da cifra (busca simulada)
  await page.route('**/functions/v1/video*', (route) => {
    route.fulfill({ json: { hits: [{ id: 'dQw4w9WgXcQ', title: 'Clipe oficial', channel: 'Banda', length: '3:56' }] } })
  })
  await page.click('button[aria-label="Vídeo da música"]')
  await page.waitForSelector('.sheet .card:has-text("Clipe oficial")', { timeout: 8000 })
  await page.click('.sheet .card:has-text("Clipe oficial")')
  await page.waitForSelector('.videopane iframe', { timeout: 8000 })
  const src = await page.getAttribute('.videopane iframe', 'src')
  check('VÍDEO: player abre ao lado da cifra', src.includes('dQw4w9WgXcQ'))
  check('VÍDEO: a cifra continua na tela junto com o vídeo', await page.isVisible('.reader.withvideo .content .cifra'))
  await page.click('button:has-text("Fechar vídeo")')
  await page.waitForTimeout(300)
  check('VÍDEO: fecha e a cifra volta a ocupar a tela', (await page.locator('.videopane').count()) === 0)
  await page.click('button[aria-label="Vídeo da música"]')
  await page.waitForSelector('.videopane iframe', { timeout: 8000 })
  check('VÍDEO: na segunda vez abre direto o vídeo já escolhido', true)
  await page.click('button:has-text("Fechar vídeo")')
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('button:has-text("Tocar o show")')

  // EDIÇÃO NO PALCO: corrigir a cifra sem sair do show
  await page.evaluate(() => { location.hash = '#/shows/show3008' })
  await page.waitForSelector('button:has-text("Tocar o show")')
  await page.click('button:has-text("Tocar o show")')
  await page.waitForSelector('.readerbar')
  const tituloAtual = await page.textContent('.readerbar .t .title')
  const antesLinhas = await page.locator('.cifra').innerText()
  await page.click('button[aria-label="Opções"]')
  await page.waitForSelector('.sheet:has-text("Corrigir a cifra"), .sheet button:has-text("Corrigir a cifra")', { timeout: 5000 })
  await page.click('.sheet button:has-text("Corrigir a cifra")')
  await page.waitForSelector('textarea.editorcifra', { timeout: 5000 })
  check('EDIÇÃO: dá para corrigir a cifra de dentro do show', true)
  const original = await page.inputValue('textarea.editorcifra')
  const guardado = await page.evaluate(async (titulo) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const songs = await new Promise((res, rej) => { const t = db.transaction('songs', 'readonly'); const r = t.objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    const s = songs.find((x) => x.title === titulo)
    return s ? s.body : ''
  }, tituloAtual)
  check('EDIÇÃO: o editor abre com a cifra guardada, igualzinha', original === guardado && original.length > 20)
  // Esc não pode derrubar o show com a correção pela metade
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('EDIÇÃO: Esc no editor não sai do show', (await page.locator('textarea.editorcifra').count()) === 1)
  await page.fill('textarea.editorcifra', original + '\n[Final]\nBb    F\nAcorde novo de teste\n')
  await page.click('.sheet .acoes button:has-text("Salvar a correção")')
  await page.waitForTimeout(700)
  check('EDIÇÃO: a folha fecha e volta para a leitura', (await page.locator('textarea.editorcifra').count()) === 0 && (await page.locator('.readerbar').count()) === 1)
  check('EDIÇÃO: continua na mesma música', (await page.textContent('.readerbar .t .title')) === tituloAtual)
  const depoisLinhas = await page.locator('.cifra').innerText()
  check('EDIÇÃO: a correção aparece na hora na cifra', depoisLinhas.includes('Acorde novo de teste') && !antesLinhas.includes('Acorde novo de teste'))
  const gravado = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const songs = await new Promise((res, rej) => { const t = db.transaction('songs', 'readonly'); const r = t.objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    return songs.some((s) => (s.body || '').includes('Acorde novo de teste'))
  })
  check('EDIÇÃO: a correção fica gravada na música', gravado)
  // com o show transposto, o editor precisa mostrar o tom ORIGINAL e avisar
  await page.click('button[aria-label="Subir meio tom"]')
  await page.waitForTimeout(300)
  await page.click('button[aria-label="Opções"]')
  await page.click('.sheet button:has-text("Corrigir a cifra")')
  await page.waitForSelector('textarea.editorcifra')
  const comTom = await page.inputValue('textarea.editorcifra')
  const avisoTom = await page.locator('.sheet .hint').first().innerText().catch(() => '')
  check('EDIÇÃO: com o show transposto, edita-se a cifra no tom original', comTom.includes('Acorde novo de teste') && comTom === (await page.evaluate(async (t) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const songs = await new Promise((res, rej) => { const tx = db.transaction('songs', 'readonly'); const r = tx.objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    const s = songs.find((x) => x.title === t)
    return s ? s.body : ''
  }, tituloAtual)))
  check('EDIÇÃO: o editor avisa que o tom do show entra por cima', /meio-tom/.test(avisoTom))
  await page.click('.sheet .acoes button:has-text("Cancelar")')
  await page.waitForTimeout(200)
  await page.click('button[aria-label="Descer meio tom"]')
  await page.waitForTimeout(300)

  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('button:has-text("Tocar o show")')

  // clipe entra sozinho junto com a cifra nova, pulando cover e aula
  await page.unroute('**/functions/v1/video*')
  await page.route('**/functions/v1/video*', (route) => {
    route.fulfill({
      json: {
        hits: [
          { id: 'covercover1', title: 'Musica Nova - Banda Teste (cover)', channel: 'Fulano', length: '3:00' },
          { id: 'oficialofi1', title: 'Musica Nova', channel: 'Banda Teste', length: '3:10' },
        ],
      },
    })
  })
  await page.evaluate(() => { location.hash = '#/library' })
  await page.waitForSelector('button[aria-label="Adicionar música"]')
  await page.click('button[aria-label="Adicionar música"]')
  await page.fill('textarea', 'Música: Musica Nova\nArtista: Banda Teste\n\n[Intro] C  G\nC     G\nUma linha qualquer\n')
  await page.click('button:has-text("Salvar música")')
  await page.waitForSelector('.readerbar', { timeout: 5000 })
  let clipe = null
  for (let i = 0; i < 40 && !clipe; i++) {
    clipe = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      const songs = await new Promise((res, rej) => { const t = db.transaction('songs', 'readonly'); const r = t.objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      db.close()
      const s = songs.find((x) => x.title === 'Musica Nova')
      return s ? s.videoId || null : null
    })
    if (!clipe) await page.waitForTimeout(250)
  }
  check('VÍDEO AUTOMÁTICO: cifra nova já vem com o clipe do canal do artista', clipe === 'oficialofi1')
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('.tabbar')
  await page.unroute('**/functions/v1/video*')
  await page.evaluate(() => { location.hash = '#/shows/show3008' })
  await page.waitForSelector('button:has-text("Tocar o show")')
  await page.click('button:has-text("Tocar o show")')
  await page.waitForSelector('.readerbar')
  await page.click('button[aria-label="Sair"]')
  await page.waitForSelector('button:has-text("Tocar o show")')

  // VÍDEO NO iPAD DEITADO: a cifra não pode ser cortada pela margem de tela grande
  const ctxL = await browser.newContext({ viewport: { width: 1180, height: 820 } }) // iPad deitado
  const pageL = await ctxL.newPage()
  pageL.on('pageerror', (e) => errors.push('L: ' + String(e)))
  await pageL.route('**/functions/v1/video*', (route) => route.fulfill({ json: { hits: [{ id: 'dQw4w9WgXcQ', title: 'Clipe', channel: 'Banda', length: '3:56' }] } }))
  await pageL.goto(APP)
  // contexto novo: cai na porta. Espera só a tela existir (a base já foi criada
  // pelo store.init) e semeia o repertório, que é o que dispensa o cadastro.
  await pageL.waitForSelector('.content', { timeout: 8000 })
  // De passagem, a porta em tela larga. A primeira versão dava margem automática
  // na própria .content, que é filha de um flex em coluna: a largura virava a da
  // maior palavra e o iPad deitado mostrava uma palavra por linha.
  await pageL.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  const larguraDaPorta = await pageL.evaluate(() => Math.round(document.querySelector('.btn.primary').getBoundingClientRect().width))
  check('PORTA: em tela larga o formulário não espreme (' + larguraDaPorta + 'px)', larguraDaPorta > 300)
  await pageL.waitForTimeout(2000)
  const LINHA_LONGA = 'Am                          G                         F                    E\nUma linha bem comprida de letra que ocupa a largura inteira da tela do iPad\n'
  await pageL.evaluate(async (corpo) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const now = Date.now()
    await new Promise((res) => {
      const t = db.transaction(['songs', 'shows'], 'readwrite')
      t.objectStore('songs').put({ id: 'vid1', title: 'Cifra Larga', artist: 'Banda', tom: 'Am', body: corpo, semitones: 0, scrollSeconds: 180, notes: '', videoId: 'dQw4w9WgXcQ', createdAt: now, updatedAt: now })
      t.objectStore('shows').put({ id: 'showvid', name: 'Show do vídeo', date: '2026-08-30', items: [{ songId: 'vid1' }], createdAt: now, updatedAt: now })
      t.oncomplete = res
    })
    db.close()
  }, '[Intro] Am  G\n\n' + LINHA_LONGA)
  await pageL.reload()
  await pageL.waitForSelector('.tabbar', { timeout: 8000 })
  await pageL.evaluate(() => { location.hash = '#/play/showvid/0' })
  await pageL.waitForSelector('.readerbar', { timeout: 8000 })
  const semVideo = await pageL.evaluate(() => {
    const c = document.querySelector('.reader .content')
    const cs = getComputedStyle(c)
    return Math.round(c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))
  })
  await pageL.click('button[aria-label="Vídeo da música"]')
  await pageL.waitForSelector('.videopane iframe', { timeout: 8000 })
  await pageL.waitForTimeout(400)
  const comVideo = await pageL.evaluate(() => {
    const c = document.querySelector('.reader .content')
    const cs = getComputedStyle(c)
    const linhas = [...document.querySelectorAll('.cifra .ln-chords, .cifra pre, .cifra .ln-tab')]
    return {
      util: Math.round(c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      margem: Math.round(parseFloat(cs.paddingLeft)),
      cortadas: linhas.filter((l) => l.scrollWidth > l.clientWidth + 1).length,
      pagina: document.documentElement.scrollWidth,
      janela: document.documentElement.clientWidth,
    }
  })
  check('VÍDEO: com o vídeo aberto a margem de tela grande não come a cifra (' + comVideo.margem + 'px)', comVideo.margem <= 20)
  check('VÍDEO: sobra mais de 700px para a cifra ao lado do vídeo (' + comVideo.util + 'px)', comVideo.util > 700)
  check('VÍDEO: nenhuma linha da cifra fica cortada', comVideo.cortadas === 0)
  check('VÍDEO: a tela não escorrega para o lado', comVideo.pagina === comVideo.janela)
  check('VÍDEO: sem o vídeo a cifra segue centralizada e larga (' + semVideo + 'px)', semVideo > 850)
  await ctxL.close()

  // ---------- conta: entrar pelo e-mail, sem senha (servidor de auth simulado) ----------
  // o bloco começa do zero: sem conta gravada
  await largaConta(page)
  await page.evaluate(() => { location.hash = '#/shows' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.content', { timeout: 8000 })
  const CODIGO_BOM = '424242'
  let ultimoToken = '' // o que o app REALMENTE mandou para o servidor
  let emailPedido = ''
  let emailsMandados = 0
  let userOk = true
  let userId = 'user-1'
  const sessaoFalsa = (email) => ({
    access_token: 'crachá-de-mentira',
    refresh_token: 'renova-de-mentira',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email },
  })
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url()
    const body = route.request().postDataJSON?.() || {}
    if (url.includes('/otp')) {
      emailPedido = body.email || ''
      emailsMandados++
      return route.fulfill({ json: {} })
    }
    if (url.includes('/verify')) {
      ultimoToken = body.token || ''
      if (body.token === CODIGO_BOM) return route.fulfill({ json: sessaoFalsa(body.email) })
      return route.fulfill({ status: 403, json: { error_code: 'otp_expired', msg: 'Token has expired or is invalid' } })
    }
    if (url.includes('/token')) {
      // devagar de propósito: é durante ESTA espera que o teste manda sair
      return new Promise((r) => setTimeout(r, 700)).then(() => route.fulfill({ json: sessaoFalsa(emailPedido) }))
    }
    if (url.includes('/user')) {
      if (!userOk) return route.fulfill({ status: 401, json: { msg: 'invalid claim: missing sub claim' } })
      return route.fulfill({ json: { id: userId, email: emailPedido } })
    }
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 400, json: { msg: 'rota não simulada' } })
  })

  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  check('CONTA: a tela Mais oferece entrar pelo e-mail', true)
  check('CONTA: nenhum campo de senha existe no app', (await page.locator('input[type="password"]').count()) === 0)

  // erro de dedo no provedor vira pergunta, não recusa
  await page.fill('input[placeholder="seu@email.com"]', 'eder@gmail.con')
  await page.click('button:has-text("Entrar com meu e-mail")')
  await page.waitForTimeout(150)
  const sugestao = await page.textContent('.content .hint:has-text("Você quis dizer")').catch(() => '')
  check('CONTA: gmail.con vira "você quis dizer gmail.com?"', sugestao.includes('eder@gmail.com'))
  check('CONTA: e-mail com erro de dedo não é mandado para ninguém', emailsMandados === 0)
  await page.click('button:has-text("Sim, corrigir")')

  await page.waitForSelector('.sheet input[placeholder="000000"]', { timeout: 8000 })
  check('CONTA: o código é pedido para o e-mail corrigido', emailPedido === 'eder@gmail.com')
  const textoSheet = await page.textContent('.sheet')
  check('CONTA: a folha diz para onde o e-mail foi', textoSheet.includes('eder@gmail.com'))

  // código errado: recado em português, sem erro técnico e sem deslogar nada
  ruidoEsperado = /403 \(Forbidden\)/
  await page.fill('.sheet input[placeholder="000000"]', '111111')
  await page.waitForTimeout(1300) // a entrada sozinha espera 500ms de silêncio antes de tentar
  const recado = await page.textContent('.sheet .hint')
  check('CONTA: código errado dá recado em português (' + recado.slice(0, 28) + '…)', /venceu|Código errado/.test(recado) && !/token|invalid/i.test(recado))

  // ---------- o código de 8 números (defeito relatado pelo Eder em 03/09) ----------
  // O servidor de contas manda de 6 a 10 números, e o projeto estava em 8. O app
  // cortava no SEXTO e mandava meio código: a pessoa via "código errado" com os
  // números certos na tela, e não havia saída nenhuma. Aqui se prova que o app
  // manda o código inteiro, do tamanho que ele vier.
  ultimoToken = ''
  await page.fill('.sheet input[placeholder="000000"]', '87654321')
  check('CÓDIGO: o campo não corta o código de 8 números', (await page.inputValue('.sheet input[placeholder="000000"]')) === '87654321')
  await page.waitForTimeout(1300)
  check('CÓDIGO: e o app manda os 8 para o servidor, não os 6 primeiros (' + ultimoToken + ')', ultimoToken === '87654321')

  // ---------- o beco sem saída do wi-fi ruim (achado da revisão de 03/09) ----------
  // Antes: qualquer falha marcava o código como queimado, inclusive queda de
  // rede. O sinal voltava, a pessoa tocava em "Entrar" com os 6 números CERTOS
  // na tela, e nada acontecia. Sem mensagem, sem spinner, sem saída.
  // o abort abaixo é de propósito: o console vai reclamar e isso é esperado
  ruidoEsperado = /ERR_FAILED|Failed to load resource/
  let redeCaida = true
  await page.route('**/auth/v1/verify*', (route) => {
    if (redeCaida) return route.abort('failed')
    return route.fallback()
  })
  await page.fill('.sheet input[placeholder="000000"]', CODIGO_BOM)
  await page.waitForTimeout(1500)
  const semRede = await page.textContent('.sheet .hint')
  check('CONTA: queda de rede fala de internet, não de código errado', /internet/i.test(semRede))

  redeCaida = false
  await page.click('.sheet button:has-text("Entrar")')
  await page.waitForSelector('.sheet h2:has-text("Pronto")', { timeout: 8000 })
  check('CONTA: com o sinal de volta, o MESMO código ainda entra', true)
  await page.unroute('**/auth/v1/verify*')
  ruidoEsperado = null
  await page.click('.sheet button:has-text("Ok")')
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  ruidoEsperado = null
  const logado = await page.textContent('.content')
  check('CONTA: o app mostra quem entrou', logado.includes('Entrando como eder@gmail.com'))

  // a sessão sobrevive a fechar e abrir o app
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  check('CONTA: reabrir o app continua logado, sem digitar nada', true)

  // e sobrevive ao modo avião: quem já entrou não é expulso por falta de sinal
  await page.context().setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  check('CONTA: sem internet quem já entrou continua entrando', true)
  await page.context().setOffline(false)

  await page.click('button:has-text("Sair da conta")')
  await page.waitForSelector('.confirmbox', { timeout: 5000 })
  await page.click('.confirmbox .btn.danger')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  const musicasDepois = await page.evaluate(() => document.querySelector('.content .hint').textContent)
  check('CONTA: sair volta para a tela de entrar', true)
  check('CONTA: sair não apaga as músicas do aparelho (' + musicasDepois.split('·')[0].trim() + ')', !musicasDepois.startsWith('0 música'))

  // ---------- o outro caminho de entrar: o link do e-mail ----------
  const linkCom = (frag) => APP + `?t=${Date.now()}#${frag}`
  // quase vencido de propósito: assim o evento 'online' dispara mesmo a renovação
  const CRACHA = 'access_token=crachá-do-link&refresh_token=renova-do-link&expires_in=60&type=magiclink'

  // link de estranho (ou já usado): o servidor recusa e NINGUÉM entra
  ruidoEsperado = /401 \(Unauthorized\)/
  userOk = false
  await page.goto(linkCom(CRACHA))
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await page.waitForSelector('.content .hint:has-text("não vale mais")', { timeout: 8000 })
  check('LINK: crachá que o servidor recusa não entra na conta de ninguém', (await page.locator('button:has-text("Sair da conta")').count()) === 0)
  ruidoEsperado = null

  // link vencido: o app explica, em vez de abrir mudo na tela de entrar
  await page.goto(linkCom('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  const recadoLink = await page.textContent('.content')
  check('LINK: link vencido explica o motivo em português', /venceu|não foi aceito|não vale mais/.test(recadoLink))

  // link bom: entra sem digitar nada
  userOk = true
  await page.goto(linkCom(CRACHA))
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  const depoisDoLink = await page.evaluate(() => ({ hash: location.hash, href: location.href }))
  check('LINK: tocar no link do e-mail entra sem digitar nada', true)
  check('LINK: o crachá some do endereço assim que é usado', !depoisDoLink.href.includes('access_token') && depoisDoLink.hash === '#/more')

  // uma renovação em voo não pode ressuscitar a conta depois de sair
  await page.evaluate(() => { window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(80) // a renovação saiu e está esperando os 700 ms do servidor
  await page.click('button:has-text("Sair da conta")')
  await page.waitForSelector('.confirmbox', { timeout: 5000 })
  await page.click('.confirmbox .btn.danger')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  await page.waitForTimeout(1200) // tempo de sobra para a renovação atrasada voltar
  check('CONTA: renovação em voo não ressuscita a conta depois de sair', (await page.locator('button:has-text("Sair da conta")').count()) === 0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  check('CONTA: depois de sair, reabrir o app continua fora da conta', true)
  // ---------- de quem é a biblioteca: adotar sim, herdar nunca ----------
  const contaAcervo = () => page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const pega = (loja) => new Promise((res, rej) => { const t = db.transaction(loja, 'readonly'); const r = t.objectStore(loja).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const [musicas, shows] = await Promise.all([pega('songs'), pega('shows')])
    db.close()
    return { musicas: musicas.length, shows: shows.length }
  })
  // a limpeza mexe no banco depois de a tela já ter mudado: espera o acervo
  const esperaAcervo = async (ok, oque) => {
    for (let i = 0; i < 60; i++) {
      const a = await contaAcervo()
      if (ok(a)) return a
      await page.waitForTimeout(100)
    }
    throw new Error('acervo não chegou no estado esperado: ' + oque)
  }
  const entraCom = async (email) => {
    await page.evaluate(() => { location.hash = '#/more' })
    await page.waitForSelector('input[placeholder="seu@email.com"]', { timeout: 8000 })
    await page.fill('input[placeholder="seu@email.com"]', email)
    await page.click('button:has-text("Entrar com meu e-mail")')
    await page.waitForSelector('.sheet input[placeholder="000000"]', { timeout: 8000 })
    await page.fill('.sheet input[placeholder="000000"]', CODIGO_BOM)
  }

  const acervoAntes = await contaAcervo()
  check('DONO: o aparelho do teste tem repertório para arriscar (' + acervoAntes.musicas + ' músicas)', acervoAntes.musicas > 0)

  // a cópia de segurança feita ANTES de qualquer troca precisa voltar depois
  const baixando = page.waitForEvent('download')
  await page.click('button:has-text("⬇ Exportar backup")')
  const arquivo = await baixando
  const backupAntes = await readFile(await arquivo.path(), 'utf8')
  check('DONO: a cópia de segurança sai com o repertório inteiro', JSON.parse(backupAntes).songs.length === acervoAntes.musicas)

  // outra conta entrando: o app AVISA e não mistura nada
  userId = 'user-2'
  await entraCom('outro@gmail.com')
  await page.waitForSelector('.sheet h2:has-text("Este aparelho já tem repertório")', { timeout: 8000 })
  const textoTroca = await page.textContent('.sheet')
  check('DONO: a troca de conta avisa o que está em jogo', textoTroca.includes(acervoAntes.musicas + ' músicas'))

  // tocar fora da folha é o gesto de sempre no app: vale como cancelar, e não
  // pode deixar o app pendurado esperando uma resposta que nunca vem
  await page.click('.sheetwrap .backdrop')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  const depoisDoToqueFora = await contaAcervo()
  check('DONO: tocar fora da folha cancela e não apaga nada', depoisDoToqueFora.musicas === acervoAntes.musicas)

  // e o app continua respondendo depois disso (a decisão não ficou travada)
  await entraCom('outro@gmail.com')
  await page.waitForSelector('.sheet h2:has-text("Este aparelho já tem repertório")', { timeout: 8000 })
  check('DONO: depois do toque fora o guarda continua funcionando', true)

  // cancelar mantém tudo e não entra
  await page.click('.sheet button:has-text("Cancelar e manter o repertório")')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  const depoisDoCancelar = await contaAcervo()
  check('DONO: cancelar a troca não apaga nada', depoisDoCancelar.musicas === acervoAntes.musicas && depoisDoCancelar.shows === acervoAntes.shows)

  // confirmar começa limpo: a conta nova não herda repertório de ninguém
  await entraCom('outro@gmail.com')
  await page.waitForSelector('.sheet h2:has-text("Este aparelho já tem repertório")', { timeout: 8000 })
  check('DONO: o botão que apaga nasce travado até a cópia ser guardada', await page.isDisabled('.sheet button.danger'))
  const baixando2 = page.waitForEvent('download')
  await page.click('.sheet button:has-text("Guardar uma cópia antes")')
  await baixando2
  check('DONO: guardada a cópia, o botão que apaga libera', !(await page.isDisabled('.sheet button.danger')))
  await page.click('.sheet button:has-text("Começar limpo nesta conta")')
  await page.waitForSelector('.confirmbox', { timeout: 5000 })
  check('DONO: apagar tudo ainda pede uma confirmação a mais', true)
  await page.click('.confirmbox .btn.danger')
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  const contaNova = await esperaAcervo((a) => a.musicas === 0 && a.shows === 0, 'conta nova vazia').catch(() => contaAcervo())
  check('DONO: conta nova começa sem música nenhuma', contaNova.musicas === 0)
  check('DONO: conta nova começa sem show nenhum', contaNova.shows === 0)
  // a chave do conjunto da conta anterior não pode sobreviver à troca: seria a
  // conta nova escrevendo por cima do backup de outra pessoa. Aqui a conta nova
  // está no grátis, então o cartão mostra a explicação da assinatura — o que
  // interessa é que nada da conta anterior continua ligado
  const syncDaAnterior = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('cifras', 1); r.onsuccess = () => res(r.result) })
    const row = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('sync'); q.onsuccess = () => res(q.result) })
    db.close()
    return !!(row?.value?.enabled && row.value.rawKey)
  })
  check(
    'DONO: a sincronização da conta anterior fica desligada',
    !syncDaAnterior && (await page.locator('button:has-text("Conectar outro aparelho")').count()) === 0
  )

  // e a cópia guardada antes volta inteira
  await page.setInputFiles('input[type="file"][accept*="json"]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupAntes) })
  await page.waitForSelector('.sheet h2:has-text("Backup importado")', { timeout: 8000 })
  await page.click('.sheet button:has-text("Ok")')
  const depoisDoImport = await contaAcervo()
  check('DONO: a cópia de antes do login volta inteira depois (' + depoisDoImport.musicas + ' músicas)', depoisDoImport.musicas === acervoAntes.musicas && depoisDoImport.shows === acervoAntes.shows)

  await page.unroute('**/auth/v1/**')

  // ---------- licença: o app pergunta ao servidor se você pagou ----------
  const DIA_MS = 86400000
  let licencaResposta = { plano: 'pago', restamMs: 20 * DIA_MS, renova: true }
  let licencaPerguntas = 0
  let licencaFalha = false
  await page.route('**/functions/v1/licenca*', (route) => {
    licencaPerguntas++
    if (licencaFalha) return route.fulfill({ status: 502, json: { error: 'servidor fora' } })
    route.fulfill({ json: licencaResposta })
  })
  // o servidor de contas volta; a sessão que já está no aparelho continua valendo
  userOk = true
  userId = 'user-2'
  emailPedido = 'outro@gmail.com'
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url()
    const body = route.request().postDataJSON?.() || {}
    if (url.includes('/otp')) { emailPedido = body.email || ''; return route.fulfill({ json: {} }) }
    if (url.includes('/verify')) return route.fulfill({ json: sessaoFalsa(body.email) })
    if (url.includes('/token')) return route.fulfill({ json: sessaoFalsa(emailPedido) })
    if (url.includes('/user')) return route.fulfill({ json: { id: userId, email: emailPedido } })
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 400, json: { msg: 'rota não simulada' } })
  })

  const gravaLicenca = (diasSemConferir, diasDeValidade) => page.evaluate(async ([sem, val]) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const conta = await new Promise((res, rej) => { const t = db.transaction('kv', 'readonly'); const r = t.objectStore('kv').get('conta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const userId = conta?.value?.userId || ''
    await new Promise((res) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put({ key: 'licenca', value: { plano: 'pago', validaAte: Date.now() + val * 86400000, conferidaEm: Date.now() - sem * 86400000, renova: true, userId } })
      t.oncomplete = res
    })
    db.close()
  }, [diasSemConferir, diasDeValidade])

  // ATIVA: quem paga vê que paga (a conta do bloco anterior continua entrada;
  // recarregar é o gancho que faz o app perguntar ao servidor simulado)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  await page.waitForFunction(() => (document.querySelector('.content')?.textContent || '').includes('Plano: pago'), null, { timeout: 8000 }).catch(() => undefined)
  const textoAtiva = await page.textContent('.content')
  check('LICENÇA: quem paga aparece como pago na tela', textoAtiva.includes('Plano: pago'))
  check('LICENÇA: sem aperto, o app não fica avisando de internet', !textoAtiva.includes('precisa de internet'))

  // PALCO: no meio do show o app não pergunta nada a ninguém.
  // Antes, deixa a resposta guardada VELHA (o servidor recusa a consulta do
  // boot), senão a pergunta adiada seria dispensada por já ter resposta fresca
  ruidoEsperado = /502 \(Bad Gateway\)/ // a recusa é de propósito, não é defeito
  licencaFalha = true
  await gravaLicenca(6, 20)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  // qualquer show com música serve; o id vem do banco, não de um nome fixo
  const showParaTocar = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const shows = await new Promise((res, rej) => { const t = db.transaction('shows', 'readonly'); const r = t.objectStore('shows').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    return (shows.find((s) => s.items && s.items.length > 0) || {}).id || ''
  })
  check('LICENÇA: existe um show com música para o teste de palco', !!showParaTocar)
  await page.evaluate((id) => { location.hash = '#/play/' + id + '/0' }, showParaTocar)
  await page.waitForSelector('.readerbar', { timeout: 8000 })
  const antesDoPalco = licencaPerguntas
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
  })
  await page.waitForTimeout(700)
  check('LICENÇA: no palco o app não pergunta nada ao servidor', licencaPerguntas === antesDoPalco)
  // sair do palco pela navegação: o que importa aqui é deixar a rota #/play
  licencaFalha = false
  ruidoEsperado = null
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  await page.waitForTimeout(800)
  check('LICENÇA: saindo do palco, a pergunta que ficou esperando acontece', licencaPerguntas > antesDoPalco)

  // TOLERÂNCIA: sem internet, quem paga continua pagando dentro dos 7 dias
  // TOLERÂNCIA: 6 dias sem internet e quem paga continua pagando

  // 5,5 dias e não 6: exatamente 6 cai em cima da virada de "1 dia" para
  // "hoje", e o teste passaria a depender de quanto o navegador demorou
  await gravaLicenca(5.5, 20)
  await page.context().setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  const textoTolerancia = await page.textContent('.content')
  check('LICENÇA: em modo avião, quem paga continua pagando', textoTolerancia.includes('Plano: pago'))
  check('LICENÇA: e o app avisa quantos dias faltam para precisar de internet', /precisa de internet em 1 dia\b/.test(textoTolerancia))

  // EXPIRADA: passados os 7 dias, volta ao grátis sem apagar nada
  const acervoAntesDaExpiracao = await contaAcervo()
  await gravaLicenca(9, 20)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  const textoExpirada = await page.textContent('.content')
  const acervoDepoisDaExpiracao = await contaAcervo()
  check('LICENÇA: passados os 7 dias sem conferir, volta aos limites do grátis', textoExpirada.includes('Plano: grátis'))
  check('LICENÇA: e o recado explica que basta conectar uma vez', /conecte na internet/i.test(textoExpirada))
  check('LICENÇA: voltar ao grátis não apaga música nenhuma', acervoDepoisDaExpiracao.musicas === acervoAntesDaExpiracao.musicas)
  await page.context().setOffline(false)

  // a resposta que chega atrasada não pode virar licença de quem entrou depois
  await page.context().setOffline(false)
  licencaResposta = { plano: 'pago', restamMs: 20 * DIA_MS, renova: true }
  let segurarLicenca = true
  await page.unroute('**/functions/v1/licenca*')
  await page.route('**/functions/v1/licenca*', async (route) => {
    licencaPerguntas++
    if (segurarLicenca) await new Promise((r) => setTimeout(r, 1500))
    route.fulfill({ json: licencaResposta })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  // com a resposta ainda no ar, sai da conta
  await page.click('button:has-text("Sair da conta")')
  await page.waitForSelector('.confirmbox', { timeout: 5000 })
  await page.click('.confirmbox .btn.danger')
  await page.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 8000 })
  await page.waitForTimeout(2000) // tempo de sobra para a resposta atrasada voltar
  const semConta = await page.textContent('.content')
  check('LICENÇA: resposta atrasada não deixa ninguém pago sem conta', !semConta.includes('Plano: pago'))
  const licencaNoBanco = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const linha = await new Promise((res, rej) => { const t = db.transaction('kv', 'readonly'); const r = t.objectStore('kv').get('licenca'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    db.close()
    return linha?.value || null
  })
  check('LICENÇA: e não grava pago no aparelho depois de sair', !licencaNoBanco || licencaNoBanco.plano !== 'pago')
  segurarLicenca = false

  await page.unroute('**/functions/v1/licenca*')
  await page.unroute('**/auth/v1/**')

  // ---------- limites do plano grátis ----------
  // O aparelho do teste tem 18 músicas e vários shows. Para as travas
  // aparecerem é preciso percorrer o caminho real: pagar e depois cair para o
  // grátis. Quem nunca pagou não perde o que já tinha, só não pode crescer.
  licencaResposta = { plano: 'pago', restamMs: 20 * DIA_MS, renova: true }
  segurarLicenca = false
  await page.route('**/functions/v1/licenca*', (route) => { licencaPerguntas++; route.fulfill({ json: licencaResposta }) })
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url()
    const body = route.request().postDataJSON?.() || {}
    if (url.includes('/otp')) { emailPedido = body.email || ''; return route.fulfill({ json: {} }) }
    if (url.includes('/verify')) return route.fulfill({ json: sessaoFalsa(body.email) })
    if (url.includes('/token')) return route.fulfill({ json: sessaoFalsa(emailPedido) })
    if (url.includes('/user')) return route.fulfill({ json: { id: userId, email: emailPedido } })
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 400, json: { msg: 'rota não simulada' } })
  })
  // entra de novo (o bloco anterior terminou fora da conta)
  await entraCom('pagante@gmail.com')
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  await page.waitForFunction(() => (document.querySelector('.content')?.textContent || '').includes('Plano: pago'), null, { timeout: 8000 })
  // agora a assinatura acaba. Um dia sem conferir e o app volta a perguntar:
  // é assim que a notícia chega de verdade, não por um evento inventado
  licencaResposta = { plano: 'gratis', restamMs: 0, renova: false }
  await gravaLicenca(1, 20)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  await page.waitForFunction(() => (document.querySelector('.content')?.textContent || '').includes('Plano: grátis'), null, { timeout: 8000 })

  const acervoNoGratis = await contaAcervo()
  check('LIMITE: o teste tem repertório acima do teto (' + acervoNoGratis.musicas + ' músicas)', acervoNoGratis.musicas > 8)
  const textoMais = await page.textContent('.content')
  check('LIMITE: a tela Mais diz o plano e que o limite já estourou', /Plano: grátis/.test(textoMais) && /no limite/.test(textoMais))

  // biblioteca: as que passaram do oitavo lugar aparecem trancadas, não somem
  await page.click('.tabbar button:has-text("Biblioteca")')
  await page.waitForSelector('.topbar h1:has-text("Biblioteca")', { timeout: 8000 })
  await page.waitForSelector('.list .card', { timeout: 8000 })
  const naBiblioteca = await page.evaluate(() => ({
    total: document.querySelectorAll('.list .card').length,
    travadas: document.querySelectorAll('.list .card.travado').length,
    cadeados: [...document.querySelectorAll('.list .card .badge')].filter((b) => b.textContent.includes('🔒')).length,
  }))
  check('LIMITE: nenhuma música sumiu da biblioteca (' + naBiblioteca.total + ' na tela)', naBiblioteca.total === acervoNoGratis.musicas)
  check('LIMITE: as 8 primeiras seguem abertas e o resto fica trancado', naBiblioteca.travadas === acervoNoGratis.musicas - 8)
  check('LIMITE: a trava aparece com cadeado, não escondida', naBiblioteca.cadeados === naBiblioteca.travadas)

  // tocar numa trancada abre a folha da assinatura, com preço e "nada é apagado"
  await page.click('.list .card.travado .grow')
  await page.waitForSelector('.sheet h2:has-text("Assinando, isso some")', { timeout: 8000 })
  const folha = await page.textContent('.sheet')
  check('LIMITE: a folha de assinatura diz o preço', folha.includes('R$ 29,90'))
  check('LIMITE: e promete, por escrito, que nada é apagado', /nada é apagado/i.test(folha))
  await page.click('.sheet button:has-text("Agora não")')

  // o ＋ da biblioteca também para no limite, em vez de deixar salvar e falhar
  await page.click('button[aria-label="Adicionar música"]')
  await page.waitForSelector('.sheet h2:has-text("Assinando, isso some")', { timeout: 8000 })
  check('LIMITE: o botão de adicionar para no teto, sem tela de erro', true)
  await page.click('.sheet button:has-text("Agora não")')

  // shows: o segundo em diante fica trancado, e o ＋ oferece a assinatura
  await page.click('.tabbar button:has-text("Shows")')
  await page.waitForSelector('.topbar h1:has-text("Shows")', { timeout: 8000 })
  await page.waitForSelector('.list .card', { timeout: 8000 })
  const nosShows = await page.evaluate(() => ({
    total: document.querySelectorAll('.list .card').length,
    travados: document.querySelectorAll('.list .card.travado').length,
  }))
  check('LIMITE: nenhum show sumiu (' + nosShows.total + ' na tela)', nosShows.total === acervoNoGratis.shows)
  check('LIMITE: só o primeiro show fica aberto', nosShows.travados === Math.max(0, acervoNoGratis.shows - 1))
  await page.click('button[aria-label="Novo show"]')
  await page.waitForSelector('.sheet h2:has-text("Assinando, isso some")', { timeout: 8000 })
  check('LIMITE: criar o segundo show oferece a assinatura', true)
  await page.click('.sheet button:has-text("Agora não")')

  // DESTRAVAR: voltar a pagar libera tudo na hora, sem refazer nada
  licencaResposta = { plano: 'pago', restamMs: 20 * DIA_MS, renova: true }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tabbar', { timeout: 12000 })
  await page.evaluate(() => { location.hash = '#/more' })
  await page.waitForSelector('button:has-text("Sair da conta")', { timeout: 8000 })
  await page.waitForFunction(() => (document.querySelector('.content')?.textContent || '').includes('Plano: pago'), null, { timeout: 8000 })
  await page.click('.tabbar button:has-text("Biblioteca")')
  await page.waitForSelector('.topbar h1:has-text("Biblioteca")', { timeout: 8000 })
  await page.waitForSelector('.list .card', { timeout: 8000 })
  const depoisDePagar = await page.evaluate(() => ({
    total: document.querySelectorAll('.list .card').length,
    travadas: document.querySelectorAll('.list .card.travado').length,
  }))
  check('LIMITE: voltar a pagar destrava tudo na hora', depoisDePagar.travadas === 0)
  check('LIMITE: e o repertório continua o mesmo, música por música', depoisDePagar.total === acervoNoGratis.musicas)

  await page.unroute('**/functions/v1/licenca*')
  await page.unroute('**/auth/v1/**')

  // marca de versão: precisa vir da rede, senão o app nunca percebe cache pela metade
  const marca = await page.evaluate(async () => {
    const r = await fetch('versao.txt?x=' + Date.now(), { cache: 'no-store' })
    return r.ok ? (await r.text()).trim() : 'falhou'
  })
  const marcaLocal = (await readFile(join(DOCS, 'app/versao.txt'), 'utf8')).trim()
  check('VERSÃO: a marca publicada chega ao app (' + marca + ')', marca === marcaLocal)
  const carimbo = await page.evaluate(async () => {
    const t = await (await fetch('assets/app.js')).text()
    return t.includes('__VERSAO__') ? 'placeholder' : 'carimbado'
  })
  check('VERSÃO: o programa sai do build com a versão carimbada dentro', carimbo === 'carimbado')

  // modo avião: derruba a rede e o app inteiro precisa continuar abrindo
  await page.evaluate(() => { location.hash = '#/shows' })
  await page.waitForSelector('.tabbar')
  await page.context().setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.readerbar, .tabbar, .topbar', { timeout: 12000 })
  const marcaOffline = await page.evaluate(async () => {
    try {
      const r = await fetch('versao.txt?x=' + Date.now(), { cache: 'no-store' })
      return r.ok ? 'veio' : 'sem resposta'
    } catch {
      return 'sem rede'
    }
  })
  check('VERSÃO: sem internet a marca some e o app não se abala', marcaOffline === 'sem rede' && (await page.locator('.tabbar, .topbar').count()) > 0)
  check('OFFLINE: app abre em modo avião (service worker servindo tudo)', true)
  await page.click('button[aria-label="Sair"]').catch(() => undefined)
  await page.context().setOffline(false)


  // ---------------------------------------------------------------------
  // A MUDANÇA DE ENDEREÇO (03/09/2026)
  // A raiz virou a página de venda e o app foi para /app/. Quem já tinha o
  // app instalado no endereço velho não pode ficar preso na porta, e os links
  // de entrada já enviados por e-mail apontam todos para a raiz.
  // ---------------------------------------------------------------------
  const RAIZ = `http://localhost:${PORT}/`

  // 1) a marca da raiz é o que avisa o app instalado no endereço velho de que
  // a casa mudou de lugar. Se ela não acompanhar a do app, o aparelho antigo
  // nunca percebe a troca e fica servindo a casca velha para sempre.
  const marcaRaiz = (await readFile(join(DOCS, 'versao.txt'), 'utf8')).trim()
  const marcaApp = (await readFile(join(DOCS, 'app/versao.txt'), 'utf8')).trim()
  check('MUDANÇA: a raiz publica a mesma versão do app (' + marcaRaiz + ')', marcaRaiz === marcaApp && marcaRaiz.length === 12)

  const ctxV = await browser.newContext({ viewport: { width: 834, height: 1112 } })
  const pv = await ctxV.newPage()

  // 2) visitante novo: precisa ver o anúncio, não um app vazio dizendo
  // "Nenhum show ainda" (era exatamente o que acontecia antes da mudança)
  await pv.goto(RAIZ)
  await pv.waitForSelector('h1', { timeout: 8000 })
  check('VENDA: a raiz mostra o anúncio, não o app', /hora do show/.test(await pv.textContent('h1')) && (await pv.locator('.tabbar').count()) === 0)
  const destino = await pv.getAttribute('a.cta', 'href')
  check('VENDA: o botão aponta para o app (' + destino + ')', destino === 'app/#/more')
  await pv.click('a.cta')
  await pv.waitForSelector('button:has-text("Entrar com meu e-mail")', { timeout: 12000 })
  check('VENDA: clicar no botão abre o app, no cadastro grátis', /\/app\//.test(pv.url()))

  // 3) o service worker da raiz existe só para desmontar a instalação antiga:
  // registra, se desregistra sozinho e some. Sem isso o cache velho continuaria
  // servindo a casca do app no lugar do anúncio.
  await pv.goto(RAIZ)
  const sobrouWorker = await pv.evaluate(async () => {
    // só os da RAIZ: o app já registrou o worker dele em /app/, e esse fica
    const daRaiz = async () =>
      (await navigator.serviceWorker.getRegistrations()).filter((r) => new URL(r.scope).pathname === '/')
    await navigator.serviceWorker.register('./sw.js')
    for (let i = 0; i < 60; i++) {
      if ((await daRaiz()).length === 0) return 0
      await new Promise((r) => setTimeout(r, 100))
    }
    return (await daRaiz()).length
  })
  check('MUDANÇA: o worker da raiz se desregistra sozinho', sobrouWorker === 0)

  // 4) o crachá do e-mail que cai na raiz não pode se perder: é de uso único,
  // e um segundo clique já daria "link inválido"
  const vistos = []
  pv.on('framenavigated', (f) => vistos.push(f.url()))
  // a busca (?t=) é o que força uma carga de verdade: só trocar o # não
  // recarrega a página, e aí o encaminhamento nem chegaria a rodar
  await pv.goto(RAIZ + '?t=' + Date.now() + '#access_token=abc&refresh_token=def&expires_in=3600', { waitUntil: 'commit' }).catch(() => undefined)
  await pv.waitForURL(/\/app\//, { timeout: 10000 }).catch(() => undefined)
  check(
    'MUDANÇA: crachá do e-mail que cai na raiz é encaminhado inteiro para o app',
    vistos.some((u) => u.includes('/app/') && u.includes('access_token=abc') && u.includes('refresh_token=def'))
  )

  // 5) quem já tem repertório neste aparelho não vê anúncio da própria casa
  await pv.goto(APP)
  await pv.waitForSelector('.content', { timeout: 12000 })
  await pv.evaluate(async (corpo) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('cifras'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const now = Date.now()
    await new Promise((res) => {
      const t = db.transaction('songs', 'readwrite')
      t.objectStore('songs').put({ id: 'mud1', title: 'Teste da Mudanca', artist: 'Exemplo', tom: 'G', body: corpo, semitones: 0, scrollSeconds: 180, notes: '', createdAt: now, updatedAt: now })
      t.oncomplete = res
    })
    db.close()
  }, FIXTURE_LONGA)
  await pv.goto(RAIZ, { waitUntil: 'commit' }).catch(() => undefined)
  await pv.waitForURL(/\/app\//, { timeout: 10000 }).catch(() => undefined)
  check('MUDANÇA: quem já tem música no aparelho cai direto no app', /\/app\//.test(pv.url()))
  await pv.waitForSelector('.tabbar', { timeout: 12000 })
  check('MUDANÇA: e o repertório continua lá depois da troca de endereço', (await pv.evaluate(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open('cifras'); r.onsuccess = () => ok(r.result) })
    return await new Promise((ok) => { const q = db.transaction('songs').objectStore('songs').count(); q.onsuccess = () => ok(q.result) })
  })) === 1)

  // 6) o endereço antigo do anúncio continua respondendo
  await pv.goto(`http://localhost:${PORT}/comecar.html`, { waitUntil: 'commit' }).catch(() => undefined)
  await pv.waitForURL((u) => !/comecar/.test(u.toString()), { timeout: 8000 }).catch(() => undefined)
  check('MUDANÇA: /comecar continua levando a algum lugar útil', !/comecar/.test(pv.url()))
  await ctxV.close()

  check('nenhum erro de JavaScript no percurso', errors.length === 0)
  if (errors.length) console.log('  erros:', errors.slice(0, 5))
} finally {
  await browser.close()
  server.close()
}

if (fails.length > 0) {
  console.log('\nFUMAÇA FALHOU: ' + fails.length + ' problema(s)')
  process.exit(1)
}
console.log('\nFUMAÇA OK: fluxo principal inteiro funcionando')
