// Build sem dependências externas: empacota o app com o Bun, copia os
// estáticos de web/ para docs/ (a pasta que o GitHub Pages serve) e gera
// o service worker com a lista de arquivos e uma versão por conteúdo.
//
// Rodar com: bun run scripts/build.ts

/// <reference lib="dom" />
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'docs')

// 1) limpa e recria docs/
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'assets'), { recursive: true })

// 2) empacota o TypeScript para um único módulo do navegador
const result = await Bun.build({
  entrypoints: [join(ROOT, 'src/main.ts')],
  outdir: join(OUT, 'assets'),
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

// 3) copia os estáticos
for (const name of readdirSync(join(ROOT, 'web'))) {
  cpSync(join(ROOT, 'web', name), join(OUT, name), { recursive: true })
}

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
const files = walk(OUT).filter((f) => f !== 'sw.js')
const hash = createHash('sha256')
for (const f of files.sort()) hash.update(f).update(readFileSync(join(OUT, f)))
const version = hash.digest('hex').slice(0, 12)

// 5) service worker: pré-cache de tudo, cache-first, ativação imediata
const precache = ['./', ...files.map((f) => './' + f)]
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
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return caches.match('./index.html').then((page) => page || fetch(req));
      }
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
writeFileSync(join(OUT, 'sw.js'), sw)

// 6) marca da versão para conferência rápida
writeFileSync(join(OUT, 'version.txt'), version + '\n')

if (!existsSync(join(OUT, 'icons/icon-192.png'))) {
  console.warn('Aviso: ícones ausentes; rode python3 scripts/icons.py antes do build.')
}
console.log('build ok — versão ' + version + ' — ' + (files.length + 1) + ' arquivos em docs/')
