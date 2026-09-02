// Quem é o dono da biblioteca deste aparelho, na prática.
//
// A regra pura mora em engine/biblioteca.ts. Aqui é o encanamento: ouvir a
// entrada e a saída da conta, perguntar para a pessoa quando for preciso, e
// executar a decisão sobre o repertório e a sincronização.
//
// O produto começa vazio para todo mundo. Então:
//   - entrar pela primeira vez ADOTA o que já está no aparelho (ninguém perde
//     o repertório por criar conta: é o pior desastre possível do lançamento);
//   - outra conta entrando COMEÇA LIMPA, com aviso e cópia de segurança antes;
//   - sair NÃO APAGA nada, e voltar com a mesma conta encontra tudo no lugar.

import { contaAtual, desfazTroca, onContaChange } from './conta.ts'
import { db } from './db.ts'
import { decideDono, resumoDoQueSai } from './engine/biblioteca.ts'
import { store } from './store.ts'
import { disableSync } from './sync.ts'

const CHAVE = 'dono'

/** O que a pessoa precisa saber antes de trocar a conta deste aparelho. */
export interface AvisoDeTroca {
  /** "14 músicas e 2 shows" */
  resumo: string
  /** O conteúdo do arquivo de backup, para guardar antes de limpar. */
  backup: () => string
}

export type RespostaDaTroca = 'comecar-limpo' | 'cancelar'

export type ResultadoDoDono = 'seguir' | 'adotou' | 'trocou' | 'cancelou' | 'falhou'

let perguntar: ((aviso: AvisoDeTroca) => Promise<RespostaDaTroca>) | null = null
// Uma decisão por vez, compartilhada: quem entrou pela tela e o vigia da conta
// esperam a MESMA resposta, senão nascem duas folhas na tela ao mesmo tempo.
let emCurso: Promise<ResultadoDoDono> | null = null
// Quantos lugares da tela estão esperando esta decisão. Se ninguém está (a
// entrada veio pelo link, no boot), o vigia é quem precisa dar o recado.
let esperandoNaTela = 0
let avisar: ((titulo: string, texto: string) => void) | null = null

/**
 * Quem é o dono gravado. Devolve null quando NÃO DEU para ler.
 *
 * A diferença entre "não tem dono" e "não consegui ler" é a diferença entre
 * adotar e herdar: se o banco falhar e devolvermos vazio, a próxima conta a
 * entrar leva o repertório de outra pessoa sem nem perguntar.
 */
async function donoGravado(): Promise<string | null> {
  try {
    const row = await db.getKv(CHAVE)
    return ((row?.value as { userId?: string } | undefined)?.userId ?? '').trim()
  } catch {
    return null
  }
}

/** Grava o dono. Falso quando não deu: quem chamou não pode cantar vitória. */
async function gravaDono(userId: string): Promise<boolean> {
  try {
    await db.putKv(CHAVE, { userId })
    return true
  } catch {
    return false
  }
}

/**
 * Confere de quem é a biblioteca e resolve. Chamada a cada mudança de conta
 * e uma vez no boot. Nunca joga erro: no pior caso não faz nada.
 */
export function ajustaDono(): Promise<ResultadoDoDono> {
  if (emCurso) return emCurso
  emCurso = decide().finally(() => {
    emCurso = null
  })
  return emCurso
}

async function decide(): Promise<ResultadoDoDono> {
  const conta = contaAtual()
  if (!conta) return 'seguir' // sair não mexe em nada do que está no aparelho
  try {
    const gravado = await donoGravado()
    if (gravado === null) return 'falhou' // sem saber de quem é, não mexe em nada
    const temConteudo = store.songs.size > 0 || store.shows.size > 0
    const decisao = decideDono(gravado, conta.userId, temConteudo)

    if (decisao === 'seguir') return 'seguir'
    if (decisao === 'adotar') return (await gravaDono(conta.userId)) ? 'adotou' : 'falhou'

    // decisao === 'trocar': repertório de outra conta neste aparelho
    const aviso: AvisoDeTroca = {
      resumo: resumoDoQueSai(store.songs.size, store.shows.size),
      backup: () => store.exportData(),
    }
    let resposta: RespostaDaTroca = 'cancelar'
    try {
      if (perguntar) resposta = await perguntar(aviso)
    } catch {
      resposta = 'cancelar' // folha quebrou: na dúvida, não apaga nada
    }
    // a conta pode ter mudado enquanto a folha esperava a pessoa decidir (o
    // servidor pode ter recusado o crachá nesse meio tempo): apagar tudo para
    // entrar numa conta em que já não se está seria o pior desfecho possível
    if (contaAtual()?.userId !== conta.userId) return 'falhou'
    if (resposta !== 'comecar-limpo') {
      // volta para a conta que estava aqui antes (ou sai, se não havia nenhuma);
      // o repertório do aparelho continua intacto de qualquer jeito
      await desfazTroca()
      return 'cancelou'
    }
    // a ordem importa: desligar a sincronização ANTES de limpar, senão o
    // aparelho vazio ainda tenta conversar com a nuvem da conta anterior.
    // Sem condição: o estado em memória pode nem ter carregado ainda, e
    // desligar duas vezes não faz mal nenhum.
    await disableSync()
    await store.limpaRepertorio()
    return (await gravaDono(conta.userId)) ? 'trocou' : 'falhou'
  } catch {
    // não mexe em nada por conta própria, e avisa: dizer "nada foi apagado"
    // quando a limpeza morreu no meio seria a pior mentira possível aqui
    return 'falhou'
  }
}

/**
 * Liga a vigilância no boot. `pergunta` é quem mostra a folha de aviso;
 * sem ela, a troca de conta é sempre cancelada (nunca apaga em silêncio).
 */
export function ligaGuardaDaBiblioteca(
  pergunta: (aviso: AvisoDeTroca) => Promise<RespostaDaTroca>,
  avisa?: (titulo: string, texto: string) => void
): void {
  perguntar = pergunta
  avisar = avisa ?? null
  const confere = () => {
    void ajustaDono().then((r) => {
      // quem entrou pela tela recebe o recado por lá; quem entrou pelo link do
      // e-mail não tem tela nenhuma esperando, e ficaria sem saber de nada
      if (r === 'falhou' && esperandoNaTela === 0) {
        avisar?.(
          'Confira o seu repertório',
          'Este aparelho não deixou o app gravar tudo agora. Abra a Biblioteca e veja se está como você deixou. Se algo faltar, importe a sua cópia de segurança em Mais.'
        )
      }
    })
  }
  onContaChange(confere)
  confere() // o app pode ter aberto já logado
}

/** Igual a ajustaDono, mas avisa que a TELA está esperando o resultado. */
export async function ajustaDonoPelaTela(): Promise<ResultadoDoDono> {
  esperandoNaTela++
  try {
    return await ajustaDono()
  } finally {
    esperandoNaTela--
  }
}
