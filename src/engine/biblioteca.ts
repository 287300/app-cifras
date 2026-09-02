// De quem é a biblioteca guardada NESTE aparelho.
//
// O produto começa vazio para todo mundo: cada pessoa monta o repertório dela
// do zero. Não existe música de exemplo, show de demonstração nem nada herdado
// de outra conta. Daí saem duas obrigações opostas, e as duas moram aqui:
//
//   1. quem já usava o app sem conta e entra pela primeira vez NÃO PODE PERDER
//      nada: a conta adota o que está no aparelho;
//   2. outra conta entrando no mesmo aparelho NÃO PODE HERDAR nada: começa
//      limpa, depois de avisar e oferecer uma cópia de segurança.
//
// Misturar as duas bibliotecas seria o pior dos mundos: ninguém saberia mais
// de quem é cada música, e a sincronização levaria a confusão para os outros
// aparelhos. Por isso as opções são adotar, seguir ou trocar. Nunca fundir.

export type DecisaoDeDono =
  | 'seguir' // já é dessa conta (ou não há conta): não mexe em nada
  | 'adotar' // passa a ser dessa conta, mantendo o que está aqui
  | 'trocar' // é de outra conta: avisa, faz cópia e começa limpo

export function decideDono(donoGravado: string, entrando: string, temConteudo: boolean): DecisaoDeDono {
  if (!entrando) return 'seguir'
  if (donoGravado === entrando) return 'seguir'
  if (!donoGravado) return 'adotar' // primeira conta deste aparelho: leva o que já existe
  // dono diferente: sem conteúdo não há o que perder nem o que herdar
  return temConteudo ? 'trocar' : 'adotar'
}

/** "14 músicas e 2 shows": o que a pessoa vê antes de confirmar a troca. */
export function resumoDoQueSai(musicas: number, shows: number): string {
  const partes: string[] = []
  if (musicas > 0) partes.push(musicas + (musicas === 1 ? ' música' : ' músicas'))
  if (shows > 0) partes.push(shows + (shows === 1 ? ' show' : ' shows'))
  if (partes.length === 0) return 'nada'
  return partes.join(' e ')
}
