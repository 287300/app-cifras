-- Quem paga, e até quando.
--
-- O e-mail é a identidade: é ele que liga a compra feita na plataforma de
-- pagamento (que não conhece a conta do app) à pessoa que entra no app.
-- Guardado sempre em minúsculas, para "Eder@" e "eder@" serem a mesma pessoa.
--
-- Uma compra pode chegar ANTES de a pessoa criar conta. Por isso a linha
-- existe por e-mail, não por usuário: a licença fica esperando e é adotada
-- no primeiro login daquele e-mail.
--
-- RLS ligada SEM POLICY NENHUMA, como nas outras tabelas: nem a chave pública
-- lê ou escreve. Só a função de borda, com a chave de serviço.

create table if not exists public.assinaturas (
  email text primary key,
  plano text not null default 'gratis' check (plano in ('gratis', 'pago')),
  -- fim do período pago; nulo enquanto a pessoa nunca pagou
  valida_ate timestamptz,
  -- falso depois de um cancelamento: vale até o fim, mas não renova
  renova boolean not null default true,
  -- de onde veio o pagamento (kiwify, hotmart, asaas) e o identificador lá
  origem text,
  externo_id text,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index if not exists assinaturas_externo_idx on public.assinaturas (origem, externo_id);

alter table public.assinaturas enable row level security;

-- Trilha do que a plataforma de pagamento mandou. Serve para responder a
-- "eu paguei e não liberou" sem depender da memória de ninguém.
create table if not exists public.eventos_pagamento (
  id bigserial primary key,
  email text,
  evento text not null,
  origem text,
  externo_id text,
  corpo jsonb,
  recebido_em timestamptz not null default now()
);

create index if not exists eventos_pagamento_email_idx on public.eventos_pagamento (email, recebido_em desc);

alter table public.eventos_pagamento enable row level security;
