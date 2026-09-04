-- Um aviso de pagamento só pode valer uma vez.
--
-- A plataforma de recebimento entrega PELO MENOS UMA VEZ: se a resposta se
-- perder no caminho, ela reenvia o mesmo aviso. Sem esta trava, a reentrega
-- de uma compra viraria um segundo mês de assinatura de graça.
--
-- A trava é do BANCO, e não de um "select antes de inserir", porque duas
-- reentregas simultâneas passariam as duas pelo select e gravariam as duas.
-- Aqui o banco decide, e decide uma vez só: a segunda inserção volta 409 e a
-- função de borda responde 200 sem mexer na licença.
--
-- O evento entra na chave junto do id porque a mesma cobrança pode gerar uma
-- compra hoje e um reembolso amanhã, e os dois precisam passar.
--
-- As linhas de trilha (recusas, cobranças criadas) ficam de fora do índice:
-- elas não têm externo_id, ou têm um id que pode se repetir, e não representam
-- dinheiro entrando.

create unique index if not exists eventos_pagamento_sem_repeticao
  on public.eventos_pagamento (origem, externo_id, evento)
  where origem is not null
    and externo_id is not null
    and evento in ('compra', 'renovacao', 'atraso', 'cancelamento', 'reembolso');
