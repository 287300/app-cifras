# App de Cifras

App de cifras para o palco, feito para o Eder Ortega e vendido como assinatura em
cifrapronta.com.br. TypeScript puro, sem dependências, PWA instalável que funciona offline.
`README.md` tem a arquitetura em uma frase e os comandos.

## O essencial antes de mexer

- `cd` no repositório em **todo** comando bash: o diretório de trabalho volta ao padrão entre
  chamadas.
- `docs/` é **saída do build**, não código-fonte. Nunca edite arquivo lá dentro: mude `src/`,
  `web/` ou `scripts/` e rode `bun run scripts/build.ts`.
- Depois de qualquer mudança: `bunx tsc -p tsconfig.json`, `bun test`, `bun run scripts/build.ts`,
  `node scripts/smoke.mjs`, e commite `docs/` junto.
- A fumaça precisa de `show-30-08.json` na raiz (gitignorado). Como recriá-lo está no doc
  "Patch de 04-09" do projeto.
- O registro npm, o pypi e as CDNs são bloqueados no sandbox, e `git push` para o GitHub também.
  Publicar é um pipeline próprio: veja "Como publicar o app" no projeto.

## Duas regras que mandam em tudo

1. **Rebaixar nunca apaga.** Acima do limite do plano, a música trava; não some.
2. **Nada interrompe o palco.** Com a rota `#/play` aberta, nenhuma mudança de conta, licença ou
   sincronização tem efeito na tela. A verificação é adiada para a saída do modo palco.

## Agent skills

### Issue tracker

As issues e as specs vivem como documentos no projeto Claude "App de cifras", não no GitHub
Issues. Veja `docs/agents/issue-tracker.md`.

### Domain docs

Contexto único. A documentação de domínio também está no projeto Claude, e as revisões datadas
fazem o papel dos ADRs. Veja `docs/agents/domain.md`.
