// Build sem dependências externas: empacota o app com o Bun, copia os
// estáticos de web/ para docs/ (a pasta que o GitHub Pages serve) e gera
// o service worker com a lista de arquivos e uma versão por conteúdo.
//
// DESDE 03/09/2026 A RAIZ É A PÁGINA DE VENDA E O APP MORA EM /app/.
// Quem chega em cifrapronta.com.br é gente que ainda não conhece o produto:
// entregar a ela um app vazio dizendo "Nenhum show ainda" era perder a venda
// na porta. Então a porta da rua passou a ser o anúncio, e o app ganhou
// endereço próprio. Três cuidados fazem a mudança não quebrar quem já usa:
//
//   1. a raiz continua publicando versao.txt com a versão nova, então o app
//      instalado (que confere essa marca a cada abertura) percebe a troca,
//      limpa o cache e recarrega sozinho;
//   2. a raiz ganhou um service worker que só sabe se autodestruir, para
//      soltar o navegador do cache antigo mesmo se a marca falhar;
//   3. a página de venda encaminha para /app/ quem já tem repertório neste
//      aparelho, e encaminha SEMPRE o link de entrada do e-mail, porque os
//      links já enviados apontam para o endereço antigo.
//
// Rodar com: bun run scripts/build.ts

/// <reference lib="dom" />
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'docs')
const APP = join(OUT, 'app') // o app inteiro mora aqui; a raiz é a venda

// 1) limpa e recria docs/, POUPANDO docs/agents/
//
// docs/ é saída de build e some inteira a cada rodada. A exceção é docs/agents/,
// que é código-fonte de verdade: são os arquivos que a skill code-review lê, e
// ela procura exatamente nesse caminho, que não dá para escolher. Antes desta
// linha, todo `bun run build` apagava os dois arquivos em silêncio, e a revisão
// seguinte rodava sem o rastreador de issues sem ninguém notar.
const POUPADOS = new Set(['agents'])
if (existsSync(OUT)) {
  for (const name of readdirSync(OUT)) {
    if (POUPADOS.has(name)) continue
    rmSync(join(OUT, name), { recursive: true, force: true })
  }
}
mkdirSync(join(APP, 'assets'), { recursive: true })

// 2) empacota o TypeScript para um único módulo do navegador
const result = await Bun.build({
  entrypoints: [join(ROOT, 'src/main.ts')],
  outdir: join(APP, 'assets'),
  target: 'browser',
  format: 'esm',
  minify: true,
  naming: 'app.js',
  sourcemap: 'none',
})
if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}

// 3) estáticos. O app leva tudo de web/, menos o que só serve à venda: as
// fotos de tela e a marca não precisam ser pré-cacheadas no aparelho de quem
// já é cliente, e pesam mais que o app inteiro.
const SO_DA_VENDA = new Set(['venda.html', 'prints', 'logo.svg'])
for (const name of readdirSync(join(ROOT, 'web'))) {
  if (SO_DA_VENDA.has(name)) continue
  cpSync(join(ROOT, 'web', name), join(APP, name), { recursive: true })
}
cpSync(join(ROOT, 'web/venda.html'), join(OUT, 'index.html'))
cpSync(join(ROOT, 'web/prints'), join(OUT, 'prints'), { recursive: true })
cpSync(join(ROOT, 'web/logo.svg'), join(OUT, 'logo.svg'))
cpSync(join(ROOT, 'web/icons'), join(OUT, 'icons'), { recursive: true }) // ícone da aba do anúncio

// endereço antigo do anúncio: continua respondendo mesmo onde não há .htaccess
writeFileSync(
  join(OUT, 'comecar.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./">' +
    '<title>Cifra Pronta</title><a href="./">Cifra Pronta</a>\n'
)

// 3.5) .htaccess para o espelho no Hostinger (o GitHub Pages ignora este arquivo):
// sem listagem de pastas e sem cache de navegador (o offline fica por conta do service worker)
writeFileSync(
  join(OUT, '.htaccess'),
  [
    'Options -Indexes',
    'Header set Cache-Control "no-cache"',
    '',
    '# a raiz é a página de venda; o app mora em /app/',
    '# o endereço antigo do anúncio manda para a raiz, que agora é o próprio anúncio',
    'RewriteEngine On',
    'RewriteRule ^comecar/?$ / [R=301,L]',
    '',
  ].join('\n')
)

// 4) lista os arquivos finais e calcula a versão pelo conteúdo
function walk(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = base ? base + '/' + name : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else out.push(rel)
  }
  return out
}
// marcas de versão e workers ficam de fora da conta: são gerados A PARTIR dela.
// docs/agents/ também fica de fora, por dois motivos: não é parte do site (não
// sobe para o servidor), e mexer num doc de agente não pode bumpar a versão do
// app e mandar todo aparelho instalado limpar cache e recarregar.
const FORA = new Set(['sw.js', '.htaccess', 'version.txt', 'versao.txt'])
const daConta = (f: string) => !f.startsWith('agents/') && !FORA.has(f.slice(f.lastIndexOf('/') + 1))

// a versão cobre a árvore inteira, caminho e conteúdo. Assim qualquer mudança
// de LUGAR (como esta, de / para /app/) muda a versão e dispara a autolimpeza
// no aparelho de quem já tinha o app instalado no endereço velho.
const todos = walk(OUT).filter(daConta)
const hash = createHash('sha256')
for (const f of todos.sort()) hash.update(f).update(readFileSync(join(OUT, f)))
const version = hash.digest('hex').slice(0, 12)

// 5) service worker do app: pré-cache de tudo que está em /app/, cache-first.
// O escopo dele é /app/, então a página de venda na raiz nunca passa por aqui.
const doApp = walk(APP).filter(daConta)
const precache = ['./', ...doApp.map((f) => './' + f)]
const sw = `// Gerado por scripts/build.ts — versão ${version}
const VERSION = 'cifras-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // varre TODAS as caixas antigas, inclusive a que o app deixou na raiz
      // antes da mudança de endereço
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'sw-ativado', version: VERSION })))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // marca de versão sempre da rede: é ela que denuncia cache pela metade
  if (/(version|versao)\\.txt$/.test(url.pathname)) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html').then((page) => page || fetch(req));
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
`
writeFileSync(join(APP, 'sw.js'), sw)

// 5.5) service worker da raiz: só sabe se autodestruir.
//
// Até 03/09/2026 o app morava na raiz e registrava um worker aqui, com poder
// sobre o site inteiro e cache-first. Se ele sobrevivesse, continuaria servindo
// a casca velha do app no lugar da página de venda, para sempre. O navegador
// confere sozinho se /sw.js mudou; ao encontrar ESTE arquivo, instala e ele se
// desregistra na hora. Ninguém registra este worker: ele só é buscado por
// instalações antigas, e some junto com elas.
//
// Não apaga cache nenhum de propósito: as caixas antigas são varridas pelo
// worker do app quando ele ativa em /app/, e apagá-las aqui deixaria um
// aparelho offline sem nada para abrir no meio da troca.
writeFileSync(
  join(OUT, 'sw.js'),
  `// Gerado por scripts/build.ts — desmonta a instalação antiga da raiz (versão ${version})
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} }))
      .catch(() => {})
  );
});
`
)

// 6) carimba a versão dentro do próprio app e escreve as marcas
const appPath = join(APP, 'assets/app.js')
const app = new TextDecoder().decode(readFileSync(appPath))
if (!app.includes('__VERSAO__')) {
  console.error('erro: o pacote não trouxe o espaço da versão (src/version.ts)')
  process.exit(1)
}
writeFileSync(appPath, app.replaceAll('__VERSAO__', version))
for (const dir of [OUT, APP]) {
  // a marca da raiz é o que avisa o app INSTALADO no endereço velho de que
  // a casa mudou de lugar; a de /app/ é a que ele confere daqui para a frente
  writeFileSync(join(dir, 'version.txt'), version + '\n')
  writeFileSync(join(dir, 'versao.txt'), version + '\n')
}

if (!existsSync(join(APP, 'icons/icon-192.png'))) {
  console.warn('Aviso: ícones ausentes; rode python3 scripts/icons.py antes do build.')
}
console.log('build ok — versão ' + version + ' — ' + (todos.length + 2) + ' arquivos em docs/ (app em docs/app/)')
