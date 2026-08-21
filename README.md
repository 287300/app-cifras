# Cifras

App pessoal de cifras para shows, feito para o Eder Ortega. Funciona como
aplicativo no iPad, 100% offline depois de instalado.

O que faz: biblioteca de cifras (cola do Cifra Club e o app formata),
setlist por show na ordem da noite, leitura de palco (tela sempre acesa,
fonte grande, rolagem automática com velocidade por música), transposição
em 1 toque com a grafia certa de sustenidos e bemóis, desenho de cada
acorde no braço do violão e nas teclas do teclado, busca "plano B" para
pedido surpresa e backup completo em arquivo.

## Instalar no iPad

1. Abra o Safari no endereço publicado (GitHub Pages deste repositório).
2. Toque no botão de compartilhar (quadrado com seta para cima).
3. Toque em "Adicionar à Tela de Início".
4. Abra pelo ícone criado. A partir daí funciona sem internet.

Requisito: iPadOS 16.4 ou mais novo (para a tela sempre acesa).

## Desenvolvimento

Sem dependências externas: o código é TypeScript puro, empacotado com o Bun.

- `bun test` roda os testes do motor de cifras (parser, transposição, acordes)
- `bunx tsc -p tsconfig.json` (ou `tsc`) faz a checagem de tipos
- `bun run scripts/build.ts` gera o app pronto em `docs/`
- `python3 scripts/icons.py` regenera os ícones
- `node scripts/smoke.mjs` roda o teste de fumaça no Chromium (fluxo completo, incluindo modo avião)

A pasta `docs/` é o site publicado (GitHub Pages serve `main` em `/docs`).
Depois de qualquer mudança: rodar testes, build e commitar `docs/` junto.

## Arquitetura em uma frase

Todo o conhecimento musical (ler cifra colada, transpor, montar acordes,
desenhar shapes) vive em `src/engine/` como funções puras testadas; as telas
em `src/ui/` apenas mostram; os dados ficam no IndexedDB do próprio iPad
(`src/db.ts` e `src/store.ts`), sem servidor.

## Publicação a partir do ambiente Claude

O ambiente de build não tem acesso git de escrita a este repositório.
A publicação é feita pela API do GitHub através do Chrome do usuário
(extensão Claude in Chrome), com um token restrito a este repositório:
gera-se um payload JSON `[{path, b64}]` dos arquivos rastreados, entrega-se
ao navegador via upload de arquivo e cria-se blobs/tree/commit/ref pela
Git Data API. A verificação compara os SHAs dos blobs com `git hash-object`
local. Detalhes no doc "Como publicar" do projeto Claude.
