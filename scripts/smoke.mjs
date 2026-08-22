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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

try {
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  check('app abre na tela de Shows', await page.isVisible('text=Shows'))

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

  // modo avião: derruba a rede e o app inteiro precisa continuar abrindo
  await page.context().setOffline(true)
  await page.reload()
  await page.waitForSelector('.readerbar, .tabbar', { timeout: 8000 })
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
