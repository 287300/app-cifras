// Capturas de tela do app para acompanhamento (viewport de iPad).
const { chromium } = await import('/home/claude/.npm-global/lib/node_modules/playwright/index.mjs').catch(() => import('playwright'))
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const DOCS = new URL('../docs', import.meta.url).pathname
const PORT = 8124
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  try {
    const data = await readFile(join(DOCS, path))
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(PORT, r))

const FIXTURE = `Tom: G\n\n[Intro]  G  D/F#  Em  C\n\n[Verso 1]\nG                D/F#\nQuando o dia clareia la fora\nEm             C\nO vento traz a memoria\nG        D          C\nE a casa se enche de luz\n\n[Refrão]\nC       D        G    Em\nVem cantar comigo agora\nC       D        G\nQue o tempo nao demora\n`

await mkdir(new URL('../shots', import.meta.url).pathname, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2 })
await page.goto(`http://localhost:${PORT}/`)
await page.waitForSelector('.tabbar')

// música de exemplo
await page.click('.tabbar button:has-text("Biblioteca")')
await page.click('button[aria-label="Adicionar música"]')
await page.fill('textarea', FIXTURE)
await page.fill('input[placeholder="Nome da música"]', 'Minha Canção')
await page.fill('input[placeholder^="Artista"]', 'Exemplo')
await page.click('button:has-text("Salvar música")')
await page.waitForSelector('.readerbar')
await page.screenshot({ path: 'shots/leitura.png' })

// desenho de acorde
await page.click('.cifra .chord >> nth=1')
await page.waitForSelector('.sheet')
await page.waitForTimeout(300)
await page.screenshot({ path: 'shots/acorde.png' })
await page.click('.sheetwrap .backdrop')

// show
await page.click('button[aria-label="Sair"]')
await page.waitForSelector('.tabbar')
await page.click('.tabbar button:has-text("Shows")')
await page.click('button[aria-label="Novo show"]')
await page.fill('input[placeholder^="Nome do show"]', 'Show 30/08')
await page.click('button:has-text("Criar show")')
await page.waitForSelector('button:has-text("＋ Música")')
await page.click('button:has-text("＋ Música")')
await page.click('.sheet .card')
await page.click('.sheet button:has-text("Concluir")')
await page.waitForSelector('.setitem')
await page.screenshot({ path: 'shots/setlist.png' })

await browser.close()
server.close()
console.log('shots ok')
