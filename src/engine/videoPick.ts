// Escolhe sozinho o clipe certo entre os resultados da busca.
//
// A régua é conservadora de propósito: melhor a música ficar sem vídeo do
// que abrir o vídeo errado no meio do ensaio. Só passa o que veio do canal
// do próprio artista, ou o que traz o nome do artista no título; e o título
// precisa conter o nome da música.

export interface VideoLike {
  id: string
  title: string
  channel: string
  length: string
}

/** Cover, aula, karaokê e afins: nunca entram sozinhos. */
const LIXO = /(cover|aula|como tocar|karaok|playback|tutorial|rea(c|ç)(ao|ão)|remix|aicover|ia cover|cifra|tablatura)/i

/** Tira acento, pontuação e caixa: "Comédia Romântica" vira "comedia romantica". */
export function normaliza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Sufixos que o YouTube gruda no canal do artista. */
const SUFIXOS = /\s*(vevo|tema|topic|oficial|official|music|records|banda)\s*$/

/** O canal é do próprio artista? Cobre "Legião Urbana", "...VEVO" e "... - Tema". */
export function isCanalDoArtista(channel: string, artist: string): boolean {
  const a = normaliza(artist)
  const c = normaliza(channel)
  if (!a || !c) return false
  if (c === a) return true
  if (c.replace(SUFIXOS, '').trim() === a) return true
  // legiaourbanaVEVO vira "legiaourbanavevo": compara sem os espaços
  const semEspaco = c.replace(/ /g, '')
  return semEspaco === a.replace(/ /g, '') + 'vevo'
}

/** O título do resultado fala da música procurada? */
export function tituloBate(title: string, songTitle: string): boolean {
  const t = normaliza(title)
  const m = normaliza(songTitle)
  if (!m) return false
  if (t.includes(m)) return true
  // título curto demais para conter tudo: exige todas as palavras da música
  const palavras = m.split(' ').filter((p) => p.length > 2)
  return palavras.length > 0 && palavras.every((p) => t.includes(p))
}

/**
 * Devolve o clipe que dá para salvar sem perguntar, ou null quando nenhum
 * resultado é bom o bastante (aí a música fica com o 🎬 para escolha a dedo).
 */
export function escolheVideo(hits: VideoLike[], songTitle: string, artist: string): VideoLike | null {
  const limpos = hits.filter((h) => !LIXO.test(h.title) && !LIXO.test(h.channel) && tituloBate(h.title, songTitle))
  const oficial = limpos.find((h) => isCanalDoArtista(h.channel, artist))
  if (oficial) return oficial
  const a = normaliza(artist)
  if (!a) return null
  return limpos.find((h) => normaliza(h.title).includes(a)) ?? null
}
