-- Cada linha passa a ter dono, e o e-mail da assinatura passa a ser sempre
-- minúsculo. Duas correções que vieram da revisão de segurança.
--
-- ---------------------------------------------------------------------------
-- 1. O CÓDIGO DE 6 NÚMEROS NÃO ERA SEGREDO
-- ---------------------------------------------------------------------------
--
-- O id do código era SHA-256("pair|" + os 6 dígitos). Sem sal e sem dono, isso
-- dá UM MILHÃO de ids, todos calculáveis de antemão numa tarde. Qualquer
-- assinante podia varrer os um milhão dentro da janela de 10 minutos, achar um
-- código pendente de outra pessoa e resgatar o pacote dela. Como o pacote é
-- embrulhado com uma chave derivada do PRÓPRIO código, e o atacante acabou de
-- descobrir qual código é, ele abriria o pacote e sairia com a chave do
-- conjunto: leria e sobrescreveria a biblioteca inteira daquela pessoa. Dava
-- para fazer o inverso também, plantando um pacote no código pendente de
-- alguém, e o aparelho novo dela entraria no conjunto do atacante.
--
-- O conserto não é aumentar o código: 6 números é o que um músico consegue
-- passar de um aparelho para o outro no palco. O conserto é AMARRAR a linha ao
-- dono. Pareamento é sempre a mesma pessoa ligando o segundo aparelho dela, e
-- os dois lados precisam de conta e assinatura para chegar até aqui. Exigindo
-- que quem resgata seja quem criou, o milhão de possibilidades deixa de valer
-- qualquer coisa: varrer tudo só encontra os próprios códigos.
--
-- ---------------------------------------------------------------------------
-- 2. A CÓPIA NA NUVEM TAMBÉM NÃO TINHA DONO
-- ---------------------------------------------------------------------------
--
-- O id do backup é hash de 256 bits sorteado no aparelho, então não é
-- adivinhável. Mas a mensagem do ticket 17 promete que "a conta prova quem pode
-- gravar e ler aquela linha", e sem coluna de dono ela não provava nada: quem
-- descobrisse um id por qualquer caminho (um backup exportado, um aparelho
-- emprestado, um log) leria e sobrescreveria. Agora a primeira gravação carimba
-- o dono e as seguintes conferem.
--
-- As duas tabelas estão vazias em 03/09/2026, então dá para exigir o dono desde
-- a primeira linha, sem transição.

alter table public.sync_backups add column if not exists dono text;
alter table public.pair_codes add column if not exists dono text;

create index if not exists sync_backups_dono_idx on public.sync_backups (dono);
create index if not exists pair_codes_dono_idx on public.pair_codes (dono);

-- ---------------------------------------------------------------------------
-- 3. E-MAIL DA ASSINATURA SEMPRE MINÚSCULO
-- ---------------------------------------------------------------------------
--
-- A venda dos primeiros clientes é na mão: o Eder digita a linha. Um "Eder@
-- Gmail.com" digitado com maiúscula não casaria com a busca (que usa o e-mail
-- normalizado do crachá), e o cliente PAGANTE receberia "sincronizar é recurso
-- da assinatura" e veria a biblioteca travar em 8 músicas. Erro nosso virando
-- cobrança na cara de quem já pagou é o pior defeito possível numa venda.
--
-- Em vez de confiar na disciplina de quem digita, o banco arruma sozinho.

update public.assinaturas set email = lower(trim(email)) where email <> lower(trim(email));

create or replace function public.assinatura_email_minusculo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists assinatura_email_minusculo_trg on public.assinaturas;
create trigger assinatura_email_minusculo_trg
  before insert or update on public.assinaturas
  for each row execute function public.assinatura_email_minusculo();
