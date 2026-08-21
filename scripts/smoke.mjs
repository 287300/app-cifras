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
const page = await browser.newPage({ viewport: { width: 834, height: 1112 } }) // iPad retrato
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

try {
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.tabbar', { timeout: 8000 })
  check('app abre na tela de Shows', await page.isVisible('text=Shows'))

  // adicionar música pela biblioteca
  await page.click('.tabbar button:has-text("Biblioteca")')
  await page.click('button[aria-label="Adicionar música"]')
  await page.fill('textarea', FIXTURE)
  await page.fill('input[placeholder="Nome da música"]', 'Minha Cancao')
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

  // rolagem automática liga e desliga
  await page.click('.scrollflag')
  check('rolagem automática liga', (await page.textContent('.scrollflag')).includes('rolando'))
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
