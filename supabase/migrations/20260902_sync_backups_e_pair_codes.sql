-- Sincronização entre aparelhos do App de Cifras.
--
-- O conteúdo chega CIFRADO pelo aparelho: aqui só ficam blocos ilegíveis.
-- Uma linha por conjunto de aparelhos; o id é o hash do segredo, que nunca
-- sai do aparelho. Por isso a RLS fica ligada SEM POLICY NENHUMA: nem a
-- chave pública lê ou escreve nada. Só a função de borda, com a chave de
-- serviço, encosta nestas tabelas.

create table if not exists public.sync_backups (
  id text primary key,
  payload text not null,
  device text,
  updated_at timestamptz not null default now()
);

-- Códigos de 6 números que ligam um aparelho novo ao conjunto. Vivem 10
-- minutos, servem uma vez só, e a própria função apaga os vencidos.
create table if not exists public.pair_codes (
  id text primary key,
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists pair_codes_created_at_idx on public.pair_codes (created_at);

alter table public.sync_backups enable row level security;
alter table public.pair_codes enable row level security;
