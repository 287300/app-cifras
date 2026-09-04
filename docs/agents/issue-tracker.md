# Rastreador de issues: docs do projeto Claude

As issues, os tickets e as especificações deste repositório **não** vivem no GitHub Issues.
Vivem como documentos no projeto Claude **"App de cifras"**, e são lidos e escritos com a
ferramenta `Projects` (`project_read`, `project_search`, `project_write`).

Duas razões, e as duas são práticas: é onde o trabalho já está (24 tickets em 21/08 a 04/09), e
`api.github.com` é bloqueada pelo proxy do sandbox, então o `gh` não alcança o GitHub daqui de
qualquer forma. Quem alcança é o Chrome do Eder, e isso é para publicar, não para tocar issue.

## Convenções

- **Um ticket por documento**, no caminho `Tickets/NN - <título em português>`, com `NN` de dois
  dígitos, sequencial. O último usado é o **24**; o próximo é o 25.
- **A especificação** de um conjunto de tickets fica em `claude/Especificação - <nome>`. Os
  tickets apontam para ela no campo `Parent`.
- **Decisões e revisões** ficam em `claude/<assunto>` (por exemplo "Revisão de 04-09",
  "Decisões da sabatina comercial").
- O título do documento é a frase que descreve o resultado do ponto de vista de quem usa o app,
  não o nome técnico da tarefa. "O app pergunta ao servidor se você pagou", não "endpoint de
  licença".

## Formato de um ticket

```markdown
# NN: Título

**Parent:** Especificação - <nome>
**Status:** <ready-for-agent | in-progress | done (dd/mm/aaaa)>

## O que construir

Um ou dois parágrafos.

## Critérios de aceite

- [ ] Frase verificável, do ponto de vista de quem usa
- [ ] ...

## Blocked by

Nenhum. (ou: NN, NN)

## Notas

O que só se descobre fazendo.
```

## Estado de triagem

Mora na linha `**Status:**` do próprio documento, não em label de sistema nenhum. Os valores em
uso hoje são `ready-for-agent`, `in-progress` e `done (dd/mm/aaaa)`. Não há arquivo de vocabulário
de triagem porque a skill `triage` não está instalada nesta conta; se um dia estiver, este é o
lugar de registrar o mapeamento.

## Quando uma skill disser "publique no rastreador"

`project_write` com o caminho `Tickets/NN - <título>`. Confira antes, com `project_info` ou
`project_search`, qual é o maior `NN` em uso, para não sobrescrever um ticket existente.

## Quando uma skill disser "busque o ticket relevante"

`project_read` com o caminho, quando você já o conhece; `project_search` quando não. A lista
completa de documentos vem em `project_info`.

## PRs como superfície de pedido

**Desligado.** Não há pull request neste fluxo: o repositório é de um autor só e a publicação é
feita por um pipeline próprio, descrito em `claude/Como publicar o app (mecanismo desta sessão)`.
