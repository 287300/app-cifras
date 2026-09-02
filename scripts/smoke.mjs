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
page.on('pageerror', (e) => errors.push(String(e)))
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

try {
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.tabbar', { timeout: 8000 })
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
  await page.click('button:has-text("Assistente de carga")')
  await page.waitForSelector('.card:has-text("Natália · Legião Urbana")')
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
  await page.route('**/functions/v1/sync*', syncMock)

  // aparelho A: ativa sem digitar senha nenhuma e manda a biblioteca para a nuvem
  await page.evaluate(() => { location.hash = '#/more' })
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
  pageB.on('pageerror', (e) => errors.push('B: ' + String(e)))
  await pageB.route('**/functions/v1/sync*', syncMock)
  await pageB.goto(`http://localhost:${PORT}/`)
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
  for (let i = 0; i < 30 && cloud.row.updatedAt === antesFlush; i++) await pageB.waitForTimeout(100)
  const levou = Date.now() - t0
  check('SYNC: sair do app manda na hora o que estava pendente (' + levou + 'ms)', cloud.row.updatedAt !== antesFlush && levou < 3000)

  // A fica parada na tela e recebe sozinha, sem ninguém tocar em nada (ronda)
  await page.goto(`http://localhost:${PORT}/?ronda=1200#/library`)
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
  await page.unroute('**/functions/v1/sync*')

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
  await pageL.goto(`http://localhost:${PORT}/`)
  await pageL.waitForSelector('.tabbar', { timeout: 8000 })
  await pageL.waitForTimeout(2000)
  await pageL.waitForSelector('.tabbar', { timeout: 8000 })
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
  const CODIGO_BOM = '424242'
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
  await page.waitForTimeout(500)
  const recado = await page.textContent('.sheet .hint')
  check('CONTA: código errado dá recado em português (' + recado.slice(0, 28) + '…)', /venceu|Código errado/.test(recado) && !/token|invalid/i.test(recado))

  await page.fill('.sheet input[placeholder="000000"]', CODIGO_BOM)
  await page.waitForSelector('.sheet h2:has-text("Pronto")', { timeout: 8000 })
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
  const linkCom = (frag) => `http://localhost:${PORT}/?t=${Date.now()}#${frag}`
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
  check('DONO: a sincronização da conta anterior fica desligada', (await page.locator('button:has-text("Ativar sincronização"), button:has-text("Começar um conjunto novo aqui")').count()) > 0)

  // e a cópia guardada antes volta inteira
  await page.setInputFiles('input[type="file"][accept*="json"]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupAntes) })
  await page.waitForSelector('.sheet h2:has-text("Backup importado")', { timeout: 8000 })
  await page.click('.sheet button:has-text("Ok")')
  const depoisDoImport = await contaAcervo()
  check('DONO: a cópia de antes do login volta inteira depois (' + depoisDoImport.musicas + ' músicas)', depoisDoImport.musicas === acervoAntes.musicas && depoisDoImport.shows === acervoAntes.shows)

  await page.unroute('**/auth/v1/**')

  // marca de versão: precisa vir da rede, senão o app nunca percebe cache pela metade
  const marca = await page.evaluate(async () => {
    const r = await fetch('versao.txt?x=' + Date.now(), { cache: 'no-store' })
    return r.ok ? (await r.text()).trim() : 'falhou'
  })
  const marcaLocal = (await readFile(join(DOCS, 'versao.txt'), 'utf8')).trim()
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
