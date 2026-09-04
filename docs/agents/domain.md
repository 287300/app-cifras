# Documentos de domínio

Como as skills de engenharia devem consumir a documentação de domínio deste repositório.

Este é um repositório de **contexto único**: um app, um domínio, um autor.

## Antes de explorar o código, leia

A documentação de domínio deste projeto **não está no repositório**: está no projeto Claude
"App de cifras", lida com `project_read` / `project_search`. Na ordem de utilidade:

- **`claude/Recursos do app (o que existe e como funciona)`** faz o papel de `CONTEXT.md`: o que
  o app faz e com que palavras.
- **`claude/Especificação - App de Cifras v2 comercial`** é a spec viva. A v1 continua lá como
  histórico.
- **`claude/Como publicar o app (mecanismo desta sessão)`** é o manual de operação: endereços,
  ordem de envio dos arquivos, armadilhas de DNS, de service worker e de painel.
- **`claude/Revisão de <data>`** faz o papel dos ADRs: cada uma registra o que quebrou, por que, e
  qual decisão foi tomada. São o lugar certo para descobrir por que algo é do jeito que é antes de
  propor mudar.

No repositório mesmo, `README.md` tem a arquitetura em uma frase e os comandos.

Se algum desses documentos não existir, siga em silêncio. Não sinalize a ausência e não proponha
criá-los por antecipação.

## Use o vocabulário do projeto

Este projeto tem uma linguagem própria, e ela é deliberada: os textos são lidos por um músico no
palco, não por um programador. Quando a sua saída nomear um conceito do domínio (título de ticket,
proposta de refatoração, nome de teste, mensagem de erro na tela), use o termo do projeto:

| Termo do projeto | O que é |
|---|---|
| **crachá** | o token de acesso da sessão |
| **a porta** | a tela de cadastro que aparece antes do app em aparelho novo |
| **o palco** / **modo palco** | a rota `#/play`, a tela de leitura durante o show |
| **a marca de versão** | `versao.txt` / `version.txt`, o arquivo que denuncia cache velho |
| **a ronda** | a verificação periódica de sincronização e de licença |
| **o conjunto** | os aparelhos que compartilham a mesma chave de sincronização |
| **esqueleto** | música cadastrada sem a cifra colada ainda |
| **rebaixar** | voltar aos limites do plano grátis, sem apagar nada |

Regra que manda em todas: **rebaixar nunca apaga**, e **nada interrompe o palco**. Qualquer
proposta que contrarie uma dessas duas está errada antes de ser avaliada.

## Sinalize conflito com uma revisão

Se a sua saída contradiz uma decisão registrada numa `claude/Revisão de <data>`, diga isso
explicitamente em vez de passar por cima em silêncio:

> _Contradiz a revisão de 03/09 (código de pareamento amarrado ao dono), mas vale reabrir porque…_
