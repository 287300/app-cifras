// Telas do app: shows e setlist, biblioteca, adicionar/editar música,
// busca plano B e mais (backup). A leitura de palco vive em reader.ts.

import { parseCifra } from '../engine/parse.ts'
import { extractImportHeader } from '../engine/importHeader.ts'
import { guessTom } from '../engine/guessTom.ts'
import { transposeKey, parseKey } from '../engine/notes.ts'
import { fetchCifraFromUrl, searchCifras, type FetchedCifra, type SearchHit } from '../importer.ts'
import { navigate, type Route } from '../router.ts'
import { store, type Show, type Song } from '../store.ts'
import { claimPairCode, createPairCode, defaultDeviceName, disableSync, enableSync, onSyncChange, pullNow, syncStatus } from '../sync.ts'
import { confirmDialog, h, sheet } from './dom.ts'
import { readerScreen, releaseWakeLock } from './reader.ts'

// ---------- pedaços comuns ----------

function topbar(title: string, opts: { back?: Route; action?: HTMLElement } = {}): HTMLElement {
  return h(
    'div',
    { className: 'topbar' },
    opts.back ? h('button', { className: 'iconbtn', 'aria-label': 'Voltar', onClick: () => navigate(opts.back!) }, '‹') : null,
    h('h1', null, title),
    opts.action ?? null
  )
}

function empty(icon: string, text: string): HTMLElement {
  return h('div', { className: 'empty' }, h('div', { className: 'big' }, icon), text)
}

function displayTom(song: Song, override?: number): string {
  const semis = override ?? song.semitones
  if (!song.tom) return '—'
  return transposeKey(song.tom, semis)
}

const TOM_OPTIONS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

/**
 * Colagem esperta: se o texto vier do botão de importar (cabeçalho
 * "Música:/Artista:"), preenche os campos vazios e deixa só a cifra no corpo;
 * o tom é detectado da cifra quando o campo ainda está vazio.
 */
function wireSmartPaste(body: HTMLTextAreaElement, fields: { title?: HTMLInputElement; artist?: HTMLInputElement; tom: HTMLSelectElement }): void {
  body.addEventListener('input', () => {
    const header = extractImportHeader(body.value)
    if (header.title !== null || header.artist !== null) {
      if (fields.title && !fields.title.value && header.title) fields.title.value = header.title
      if (fields.artist && !fields.artist.value && header.artist) fields.artist.value = header.artist
      body.value = header.body
    }
    if (!fields.tom.value) {
      const parsed = parseCifra(body.value)
      if (parsed.tom && parseKey(parsed.tom)) fields.tom.value = parsed.tom
    }
  })
}

/** Bloco de busca de cifra na internet: nome + banda e botões de busca. */
function searchBlock(initial = ''): HTMLElement {
  const query = h('input', { placeholder: 'Nome da música e banda (ex.: Natalia Legião Urbana)', value: initial }) as HTMLInputElement
  const open = (base: string) => {
    const q = query.value.trim()
    if (q) window.open(base + encodeURIComponent(q), '_blank')
  }
  return h(
    'div',
    { className: 'field' },
    h('label', null, 'Buscar a cifra na internet'),
    query,
    h(
      'div',
      { className: 'row', style: { marginTop: '10px' } },
      h('button', { className: 'btn small', style: { flex: '1' }, onClick: () => open('https://www.cifraclub.com.br/?q=') }, 'Cifra Club'),
      h('button', { className: 'btn small', style: { flex: '1' }, onClick: () => open('https://www.google.com/search?q=cifra+') }, 'Google')
    ),
    h(
      'p',
      { className: 'hint', style: { marginTop: '8px' } },
      'Na página da cifra, toque no favorito "Copiar cifra" (uma vez instalado) e volte aqui: o Colar preenche tudo. ',
      h('a', { href: '#/botao', style: { color: 'var(--blue)' } }, 'Instalar o botão')
    )
  )
}

function tomSelect(value: string): HTMLSelectElement {
  const sel = h('select', null) as HTMLSelectElement
  sel.append(h('option', { value: '' }, 'Tom…'))
  for (const t of TOM_OPTIONS) sel.append(h('option', { value: t, selected: t === value }, t))
  if (value && !TOM_OPTIONS.includes(value)) sel.append(h('option', { value, selected: true }, value))
  return sel
}

// ---------- shows ----------

export function showsScreen(): HTMLElement {
  const root = h('div', { className: 'screen' })
  const add = h('button', { className: 'iconbtn', 'aria-label': 'Novo show', onClick: () => newShowSheet() }, '＋')
  root.append(topbar('Shows', { action: add }))
  const content = h('div', { className: 'content' })
  const shows = store.showList()
  if (shows.length === 0) {
    content.append(empty('🎤', 'Nenhum show ainda. Toque em ＋ para criar o primeiro e montar a setlist.'))
  } else {
    const list = h('div', { className: 'list' })
    for (const show of shows) {
      list.append(
        h(
          'button',
          { className: 'card', onClick: () => navigate({ name: 'show', id: show.id }) },
          h(
            'div',
            { className: 'grow' },
            h('div', { className: 'title' }, show.name),
            h('div', { className: 'meta' }, `${formatDate(show.date)} · ${show.items.length} música${show.items.length === 1 ? '' : 's'}`)
          ),
          h('span', { className: 'hint' }, '›')
        )
      )
    }
    content.append(list)
  }
  root.append(content)
  return root
}

function formatDate(iso: string): string {
  if (!iso) return 'sem data'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function newShowSheet(): void {
  const name = h('input', { placeholder: 'Nome do show (ex.: Aniversário da Ana)' }) as HTMLInputElement
  const date = h('input', { type: 'date' }) as HTMLInputElement
  const close = sheet(
    h('h2', null, 'Novo show'),
    h('div', { className: 'field' }, h('label', null, 'Nome'), name),
    h('div', { className: 'field' }, h('label', null, 'Data'), date),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          const show = await store.addShow({ name: name.value, date: date.value })
          close()
          navigate({ name: 'show', id: show.id })
        },
      },
      'Criar show'
    )
  )
}

// ---------- setlist de um show ----------

export function showEditScreen(id: string): HTMLElement {
  const root = h('div', { className: 'screen' })
  const show = store.shows.get(id)
  if (!show) {
    root.append(topbar('Show', { back: { name: 'shows' } }), h('div', { className: 'content' }, empty('❓', 'Show não encontrado.')))
    return root
  }

  const menuBtn = h(
    'button',
    {
      className: 'iconbtn',
      'aria-label': 'Opções do show',
      onClick: () => {
        const close = sheet(
          h('h2', null, show.name),
          h(
            'button',
            {
              className: 'btn block',
              onClick: () => {
                close()
                renameShowSheet(show)
              },
            },
            'Renomear / mudar data'
          ),
          h(
            'button',
            {
              className: 'btn danger block',
              style: { marginTop: '10px' },
              onClick: async () => {
                close()
                if (await confirmDialog(`Excluir o show "${show.name}"? As músicas continuam na biblioteca.`)) {
                  await store.deleteShow(show.id)
                  navigate({ name: 'shows' })
                }
              },
            },
            'Excluir show'
          )
        )
      },
    },
    '⋯'
  )

  root.append(topbar(show.name, { back: { name: 'shows' }, action: menuBtn }))
  const content = h('div', { className: 'content' })

  content.append(
    h(
      'div',
      { className: 'row', style: { marginBottom: '14px' } },
      h(
        'button',
        {
          className: 'btn primary',
          style: { flex: '1' },
          onClick: () => {
            if (show.items.length > 0) navigate({ name: 'play', showId: show.id, idx: 0 })
          },
          disabled: show.items.length === 0,
        },
        '▶  Tocar o show'
      ),
      h('button', { className: 'btn', onClick: () => addSongsSheet(show) }, '＋ Música'),
      h('button', { className: 'btn', onClick: () => navigate({ name: 'planb', showId: show.id }) }, 'Plano B')
    )
  )

  const pendentes = show.items.map((it) => store.songs.get(it.songId)).filter((s): s is Song => !!s && isSkeleton(s)).length
  if (pendentes > 0) {
    content.append(
      h(
        'button',
        {
          className: 'btn primary block',
          style: { marginBottom: '14px', minHeight: '58px' },
          onClick: () => navigate({ name: 'carga', showId: show.id }),
        },
        `🪄 Assistente de carga: faltam ${pendentes} cifra${pendentes === 1 ? '' : 's'}`
      )
    )
  }

  if (show.items.length === 0) {
    content.append(empty('🎼', 'Setlist vazia. Toque em ＋ Música para trazer músicas da biblioteca, na ordem do show.'))
  } else {
    const list = h('div', { className: 'list' })
    show.items.forEach((item, idx) => {
      const song = store.songs.get(item.songId)
      if (!song) return
      const tomBadge = h(
        'button',
        {
          className: 'badge',
          'aria-label': 'Tom desta música neste show',
          onClick: (e: Event) => {
            e.stopPropagation()
            perShowToneSheet(show, idx, song)
          },
        },
        displayTom(song, item.semitones ?? song.semitones)
      )
      const card = h(
        'div',
        { className: 'card setitem', dataset: { idx: String(idx) } },
        h('span', { className: 'pos' }, String(idx + 1)),
        h(
          'button',
          { className: 'grow', style: { textAlign: 'left', minWidth: '0' }, onClick: () => navigate({ name: 'play', showId: show.id, idx }) },
          h('div', { className: 'title' }, song.title),
          h('div', { className: 'meta' }, song.artist || ' ')
        ),
        tomBadge,
        // subir e descer na ordem do show: arrastar continua valendo, mas no
        // iPad dois toques secos são bem mais confiáveis que arrastar
        h(
          'button',
          {
            className: 'iconbtn ordbtn',
            'aria-label': 'Subir na ordem',
            disabled: idx === 0,
            style: idx === 0 ? { opacity: '0.25' } : null,
            onClick: async (e: Event) => {
              e.stopPropagation()
              if (idx === 0) return
              const items = [...show.items]
              ;[items[idx - 1], items[idx]] = [items[idx]!, items[idx - 1]!]
              await store.updateShow(show.id, { items })
              rerender()
            },
          },
          '↑'
        ),
        h(
          'button',
          {
            className: 'iconbtn ordbtn',
            'aria-label': 'Descer na ordem',
            disabled: idx === show.items.length - 1,
            style: idx === show.items.length - 1 ? { opacity: '0.25' } : null,
            onClick: async (e: Event) => {
              e.stopPropagation()
              if (idx === show.items.length - 1) return
              const items = [...show.items]
              ;[items[idx + 1], items[idx]] = [items[idx]!, items[idx + 1]!]
              await store.updateShow(show.id, { items })
              rerender()
            },
          },
          '↓'
        ),
        h(
          'button',
          {
            className: 'iconbtn',
            'aria-label': 'Remover do show',
            onClick: async (e: Event) => {
              e.stopPropagation()
              const items = show.items.filter((_, i) => i !== idx)
              await store.updateShow(show.id, { items })
              rerender()
            },
          },
          '−'
        ),
        h('span', { className: 'handle', 'aria-label': 'Arrastar para reordenar' }, '≡')
      )
      enableDrag(card, list, async () => {
        const order = [...list.children].map((el) => Number((el as HTMLElement).dataset.idx))
        const items = order.map((i) => show.items[i]!)
        await store.updateShow(show.id, { items })
        rerender()
      })
      list.append(card)
    })
    content.append(list)
  }

  root.append(content)

  function rerender() {
    const fresh = showEditScreen(id)
    root.replaceWith(fresh)
  }
  return root
}

function renameShowSheet(show: Show): void {
  const name = h('input', { value: show.name }) as HTMLInputElement
  const date = h('input', { type: 'date', value: show.date }) as HTMLInputElement
  const close = sheet(
    h('h2', null, 'Editar show'),
    h('div', { className: 'field' }, h('label', null, 'Nome'), name),
    h('div', { className: 'field' }, h('label', null, 'Data'), date),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          await store.updateShow(show.id, { name: name.value.trim() || show.name, date: date.value })
          close()
          navigate({ name: 'show', id: show.id })
        },
      },
      'Salvar'
    )
  )
}

function perShowToneSheet(show: Show, idx: number, song: Song): void {
  const item = show.items[idx]!
  let semis = item.semitones ?? song.semitones
  const label = h('div', { className: 'badge', style: { fontSize: '22px', padding: '10px 16px' } }, displayTom(song, semis))
  const update = () => {
    label.textContent = displayTom(song, semis)
  }
  const close = sheet(
    h('h2', null, `Tom de "${song.title}" neste show`),
    h(
      'div',
      { className: 'row', style: { justifyContent: 'center', margin: '10px 0 18px' } },
      h('button', { className: 'iconbtn', style: { fontSize: '28px' }, onClick: () => { semis--; update() } }, '♭'),
      label,
      h('button', { className: 'iconbtn', style: { fontSize: '28px' }, onClick: () => { semis++; update() } }, '♯')
    ),
    h('p', { className: 'hint', style: { marginBottom: '12px' } }, 'Vale só para este show. O tom padrão da música na biblioteca não muda.'),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          const items = show.items.map((it, i) => (i === idx ? { ...it, semitones: semis } : it))
          await store.updateShow(show.id, { items })
          close()
          navigate({ name: 'show', id: show.id })
        },
      },
      'Salvar'
    )
  )
}

function addSongsSheet(show: Show): void {
  const search = h('input', { placeholder: 'Buscar na biblioteca…' }) as HTMLInputElement
  const list = h('div', { className: 'list', style: { marginTop: '12px' } })
  const inShow = new Set(show.items.map((i) => i.songId))

  const renderList = () => {
    list.replaceChildren()
    const songs = store.searchSongs(search.value)
    if (songs.length === 0) {
      list.append(h('p', { className: 'hint' }, 'Nada encontrado. A música precisa entrar antes pela Biblioteca (aba de baixo) ou pelo Plano B.'))
    }
    for (const song of songs) {
      const added = inShow.has(song.id)
      list.append(
        h(
          'button',
          {
            className: 'card',
            style: added ? { opacity: '0.5' } : null,
            onClick: async () => {
              if (added) return
              inShow.add(song.id)
              await store.updateShow(show.id, { items: [...store.shows.get(show.id)!.items, { songId: song.id }] })
              renderList()
            },
          },
          h('div', { className: 'grow' }, h('div', { className: 'title' }, song.title), h('div', { className: 'meta' }, song.artist || ' ')),
          h('span', { className: 'badge' }, added ? '✓' : displayTom(song))
        )
      )
    }
  }
  search.addEventListener('input', renderList)
  renderList()

  const close = sheet(
    h('h2', null, 'Adicionar à setlist'),
    search,
    list,
    h(
      'button',
      {
        className: 'btn block',
        style: { marginTop: '14px' },
        onClick: () => {
          close()
          navigate({ name: 'show', id: show.id })
        },
      },
      'Concluir'
    )
  )
}

// arrasto vertical simples com pointer events no punho ≡
function enableDrag(card: HTMLElement, list: HTMLElement, onDrop: () => void): void {
  const handle = card.querySelector('.handle') as HTMLElement
  handle.addEventListener('pointerdown', (down) => {
    down.preventDefault()
    handle.setPointerCapture(down.pointerId)
    card.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      const cards = [...list.children] as HTMLElement[]
      for (const other of cards) {
        if (other === card) continue
        const r = other.getBoundingClientRect()
        const mid = r.top + r.height / 2
        const cardIdx = cards.indexOf(card)
        const otherIdx = cards.indexOf(other)
        if (ev.clientY > mid && otherIdx > cardIdx) list.insertBefore(other, card)
        else if (ev.clientY < mid && otherIdx < cardIdx) list.insertBefore(card, other)
      }
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      card.classList.remove('dragging')
      onDrop()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  })
}

// ---------- player (leitura do show) ----------

export function playerScreen(showId: string, idx: number): HTMLElement {
  const show = store.shows.get(showId)
  if (!show || show.items.length === 0) {
    navigate({ name: 'shows' })
    return h('div', null)
  }
  const entries = show.items
    .map((item, itemIdx) => {
      const song = store.songs.get(item.songId)
      if (!song) return null
      return {
        song,
        semitones: item.semitones ?? song.semitones,
        onSemitones: (n: number) => {
          // pelo índice: a mesma música pode aparecer duas vezes na setlist em tons diferentes
          const items = store.shows.get(showId)!.items.map((it, i) => (i === itemIdx ? { ...it, semitones: n } : it))
          void store.updateShow(showId, { items })
        },
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  return readerScreen({
    entries,
    index: Math.min(idx, entries.length - 1),
    onIndex: (i) => history.replaceState(null, '', '#/play/' + showId + '/' + i),
    onExit: () => {
      releaseWakeLock()
      navigate({ name: 'show', id: showId })
    },
    subtitle: (i) => `${show.name} · ${i + 1} de ${entries.length}`,
  })
}

// ---------- biblioteca ----------

export function libraryScreen(): HTMLElement {
  const root = h('div', { className: 'screen' })
  const add = h('button', { className: 'iconbtn', 'aria-label': 'Adicionar música', onClick: () => navigate({ name: 'add', to: null }) }, '＋')
  root.append(topbar('Biblioteca', { action: add }))
  const content = h('div', { className: 'content' })
  const search = h('input', { placeholder: 'Buscar por nome ou artista…', style: { marginBottom: '12px' } }) as HTMLInputElement
  const list = h('div', { className: 'list' })

  const renderList = () => {
    list.replaceChildren()
    const songs = store.searchSongs(search.value)
    if (songs.length === 0) {
      list.append(
        store.songs.size === 0
          ? empty('🎸', 'Biblioteca vazia. Toque em ＋, cole uma cifra do Cifra Club e ela entra formatada.')
          : empty('🔍', 'Nada encontrado com essa busca.')
      )
      return
    }
    for (const song of songs) {
      list.append(
        h(
          'div',
          { className: 'card' },
          h(
            'button',
            { className: 'grow', style: { textAlign: 'left', minWidth: '0' }, onClick: () => navigate({ name: 'song', id: song.id }) },
            h('div', { className: 'title' }, song.title),
            h('div', { className: 'meta' }, song.artist || ' ')
          ),
          h('span', { className: 'badge' }, displayTom(song)),
          h(
            'button',
            {
              className: 'iconbtn',
              'aria-label': 'Excluir música',
              onClick: async () => {
                if (await confirmDialog(`Excluir "${song.title}" da biblioteca? Ela também sai de todos os shows.`)) {
                  await store.deleteSong(song.id)
                  renderList()
                }
              },
            },
            '🗑'
          )
        )
      )
    }
  }
  search.addEventListener('input', renderList)
  renderList()

  content.append(search, list)
  root.append(content)
  return root
}

// ---------- leitura de uma música da biblioteca ----------

export function songScreen(id: string): HTMLElement {
  const song = store.songs.get(id)
  if (!song) {
    navigate({ name: 'library' })
    return h('div', null)
  }
  return readerScreen({
    entries: [
      {
        song,
        semitones: song.semitones,
        onSemitones: (n) => void store.updateSong(id, { semitones: n }),
      },
    ],
    index: 0,
    onIndex: () => undefined,
    onExit: () => {
      releaseWakeLock()
      navigate({ name: 'library' })
    },
    onEditCurrent: () => navigate({ name: 'edit', id }),
  })
}

// ---------- adicionar música (colar cifra) ----------

export function addScreen(to: string | null): HTMLElement {
  const root = h('div', { className: 'screen' })
  const back: Route = to ? { name: 'show', id: to } : { name: 'library' }
  root.append(topbar('Nova música', { back }))
  const content = h('div', { className: 'content' })

  const body = h('textarea', { rows: 12, placeholder: 'Cole aqui a cifra copiada do Cifra Club ou de onde preferir…' }) as HTMLTextAreaElement
  const title = h('input', { placeholder: 'Nome da música' }) as HTMLInputElement
  const artist = h('input', { placeholder: 'Artista (opcional)' }) as HTMLInputElement
  const tom = tomSelect('')

  const pasteBtn = h(
    'button',
    {
      className: 'btn primary block',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText()
          if (text) {
            body.value = text
            body.dispatchEvent(new Event('input'))
          }
        } catch {
          body.focus()
        }
      },
    },
    '📋 Colar cifra copiada (preenche tudo sozinho)'
  )

  wireSmartPaste(body, { title, artist, tom })

  content.append(
    h(
      'button',
      { className: 'btn primary block', style: { marginBottom: '14px' }, onClick: () => navigate({ name: 'buscar', showId: to }) },
      '🔍 Buscar e importar pelo nome'
    ),
    searchBlock(),
    h('div', { className: 'field' }, pasteBtn),
    h('div', { className: 'field' }, h('label', null, 'Cifra'), body),
    h('div', { className: 'field' }, h('label', null, 'Nome da música'), title),
    h('div', { className: 'field' }, h('label', null, 'Artista'), artist),
    h('div', { className: 'field' }, h('label', null, 'Tom em que você toca (detectado da colagem quando possível)'), tom),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          if (!body.value.trim()) {
            body.focus()
            return
          }
          const song = await store.addSong({ title: title.value, artist: artist.value, tom: tom.value, body: body.value })
          if (to) {
            const show = store.shows.get(to)
            if (show) await store.updateShow(to, { items: [...show.items, { songId: song.id }] })
            navigate({ name: 'show', id: to })
          } else {
            navigate({ name: 'song', id: song.id })
          }
        },
      },
      'Salvar música'
    )
  )
  root.append(content)
  return root
}

// ---------- editar música ----------

export function editScreen(id: string): HTMLElement {
  const root = h('div', { className: 'screen' })
  const song = store.songs.get(id)
  if (!song) {
    navigate({ name: 'library' })
    return root
  }
  root.append(topbar('Editar: ' + song.title, { back: { name: 'song', id } }))
  const content = h('div', { className: 'content' })

  const title = h('input', { value: song.title }) as HTMLInputElement
  const artist = h('input', { value: song.artist }) as HTMLInputElement
  const tom = tomSelect(song.tom)
  const notes = h('textarea', { rows: 3, placeholder: 'Observações suas (ex.: entra só no 2º verso; diminuir no final)' }) as HTMLTextAreaElement
  notes.value = song.notes
  const body = h('textarea', { rows: 16 }) as HTMLTextAreaElement
  body.value = song.body
  // colar por cima de um esqueleto: cabeçalho do botão de importar vira campos
  // (sem sobrescrever o que já está preenchido) e o tom é detectado da cifra
  wireSmartPaste(body, { title, artist, tom })
  const pasteOverBtn = h(
    'button',
    {
      className: 'btn block',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText()
          if (text) {
            body.value = text
            body.dispatchEvent(new Event('input'))
          }
        } catch {
          body.focus()
        }
      },
    },
    '📋 Colar cifra por cima (substitui o texto abaixo)'
  )

  content.append(
    h('div', { className: 'field' }, h('label', null, 'Nome'), title),
    h('div', { className: 'field' }, h('label', null, 'Artista'), artist),
    h('div', { className: 'field' }, h('label', null, 'Tom'), tom),
    h('div', { className: 'field' }, h('label', null, 'Observações (aparecem destacadas na leitura)'), notes),
    h('div', { className: 'field' }, pasteOverBtn),
    h('div', { className: 'field' }, h('label', null, 'Cifra'), body),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          await store.updateSong(id, {
            title: title.value.trim() || song.title,
            artist: artist.value.trim(),
            tom: tom.value,
            notes: notes.value,
            body: body.value,
          })
          navigate({ name: 'song', id })
        },
      },
      'Salvar alterações'
    ),
    h(
      'button',
      {
        className: 'btn danger block',
        style: { marginTop: '12px' },
        onClick: async () => {
          if (await confirmDialog(`Excluir "${song.title}" da biblioteca? Ela também sai de todos os shows.`)) {
            await store.deleteSong(id)
            navigate({ name: 'library' })
          }
        },
      },
      'Excluir música'
    )
  )
  root.append(content)
  return root
}

// ---------- plano B (pedido surpresa) ----------

export function planbScreen(showId: string | null): HTMLElement {
  const root = h('div', { className: 'screen' })
  const back: Route = showId ? { name: 'show', id: showId } : { name: 'more' }
  root.append(topbar('Plano B: pedido surpresa', { back }))
  const content = h('div', { className: 'content' })

  if (!navigator.onLine) {
    content.append(h('div', { className: 'banner' }, 'Sem internet agora. A busca online não vai funcionar, mas tudo que já está salvo continua disponível. Dica: ligue o hotspot do iPhone.'))
  } else {
    content.append(h('div', { className: 'banner ok' }, 'Com internet. Busque a cifra, copie o texto dela e cole aqui embaixo: ela entra direto na leitura de palco.'))
  }

  const body = h('textarea', { rows: 8, placeholder: 'Cole a cifra copiada aqui…' }) as HTMLTextAreaElement
  const title = h('input', { placeholder: 'Nome da música' }) as HTMLInputElement
  const artist = h('input', { placeholder: 'Artista (opcional)' }) as HTMLInputElement
  const tom = tomSelect('')
  wireSmartPaste(body, { title, artist, tom })

  const pasteBtn = h(
    'button',
    {
      className: 'btn primary block',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText()
          if (text) {
            body.value = text
            body.dispatchEvent(new Event('input'))
          }
        } catch {
          body.focus()
        }
      },
    },
    '📋 Colar cifra copiada (preenche tudo sozinho)'
  )

  content.append(
    h(
      'button',
      { className: 'btn primary block', style: { marginBottom: '14px' }, onClick: () => navigate({ name: 'buscar', showId } ) },
      '🔍 Buscar e importar pelo nome'
    ),
    searchBlock(),
    h('div', { className: 'field' }, pasteBtn),
    h('div', { className: 'field' }, h('label', null, 'Cifra'), body),
    h('div', { className: 'field' }, h('label', null, 'Nome'), title),
    h('div', { className: 'field' }, h('label', null, 'Artista'), artist),
    h('div', { className: 'field' }, h('label', null, 'Tom (detectado quando possível)'), tom),
    h(
      'button',
      {
        className: 'btn primary block',
        onClick: async () => {
          if (!body.value.trim()) {
            body.focus()
            return
          }
          const song = await store.addSong({ title: title.value || 'Pedido surpresa', artist: artist.value, tom: tom.value, body: body.value })
          if (showId) {
            const show = store.shows.get(showId)
            if (show) {
              await store.updateShow(showId, { items: [...show.items, { songId: song.id }] })
              navigate({ name: 'play', showId, idx: store.shows.get(showId)!.items.length - 1 })
              return
            }
          }
          navigate({ name: 'song', id: song.id })
        },
      },
      '▶ Tocar agora'
    )
  )
  root.append(content)
  return root
}

// ---------- mais (backup e informações) ----------

/** Mostra o código de 6 números para ligar outro aparelho a este conjunto. */
function pairSheet(): void {
  const big = h('div', { className: 'paircode' }, '······')
  const hint = h('p', { className: 'hint' }, 'Gerando o código…')
  sheet(
    h('h2', null, 'Conectar outro aparelho'),
    big,
    hint,
    h(
      'p',
      { className: 'hint', style: { marginTop: '10px' } },
      'No outro aparelho: abra o app, vá em Mais, toque em "Tenho um código de outro aparelho" e digite estes números.'
    )
  )
  void (async () => {
    try {
      const code = await createPairCode()
      big.textContent = code.slice(0, 3) + ' ' + code.slice(3)
      hint.textContent = 'Vale por 10 minutos e serve para um aparelho.'
    } catch (err) {
      big.textContent = '······'
      hint.textContent = err instanceof Error ? err.message : 'Não deu para gerar agora.'
    }
  })()
}

/** Recebe o código do outro aparelho e entra no mesmo conjunto. */
function claimSheet(deviceName: string, onDone: () => void): void {
  const input = h('input', {
    type: 'text',
    inputMode: 'numeric',
    autocomplete: 'one-time-code',
    placeholder: '000000',
    style: { fontSize: '28px', textAlign: 'center', letterSpacing: '6px', fontFamily: 'var(--mono)' },
  }) as HTMLInputElement
  const status = h('p', { className: 'hint', style: { marginTop: '10px' } }, 'Digite os 6 números que aparecem no outro aparelho.')
  const btn = h(
    'button',
    {
      className: 'btn primary block',
      style: { marginTop: '12px' },
      onClick: async () => {
        btn.textContent = 'Conectando…'
        ;(btn as HTMLButtonElement).disabled = true
        try {
          await claimPairCode(input.value, deviceName)
          close()
          alertSheet('Aparelhos conectados', 'As músicas do outro aparelho já estão chegando aqui.')
          onDone()
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : 'Não deu certo.'
          btn.textContent = 'Conectar'
          ;(btn as HTMLButtonElement).disabled = false
        }
      },
    },
    'Conectar'
  )
  const close = sheet(h('h2', null, 'Tenho um código'), input, status, btn)
  setTimeout(() => input.focus(), 100)
}

/** Cartão da sincronização entre aparelhos (o "carteiro" das músicas). */
function syncCard(): HTMLElement {
  const wrap = h('div', { style: { marginBottom: '24px' } })

  const fmtHora = (t: number) =>
    new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const render = () => {
    const st = syncStatus()
    const parts: (HTMLElement | null)[] = [
      h('h2', { style: { fontSize: '18px', margin: '8px 0' } }, 'Sincronizar entre aparelhos'),
    ]
    if (!st.enabled) {
      const deviceInput = h('input', {
        type: 'text',
        value: defaultDeviceName(),
        placeholder: 'Nome deste aparelho',
        style: { marginBottom: '10px' },
      }) as HTMLInputElement
      const btn = h(
        'button',
        {
          className: 'btn primary block',
          onClick: async () => {
            btn.textContent = 'Ativando…'
            ;(btn as HTMLButtonElement).disabled = true
            try {
              await enableSync(deviceInput.value)
              alertSheet('Sincronização ligada', 'Nos outros aparelhos, toque em "Tenho um código" e use o código que aparece aqui.')
            } catch (err) {
              alertSheet('Não deu certo', err instanceof Error ? err.message : 'Tente de novo com internet.')
            }
            render()
          },
        },
        'Ativar sincronização'
      )
      const claimBtn = h(
        'button',
        {
          className: 'btn block',
          style: { marginTop: '10px' },
          onClick: () => claimSheet(deviceInput.value, render),
        },
        'Tenho um código de outro aparelho'
      )
      parts.push(
        h(
          'p',
          { className: 'hint', style: { marginBottom: '10px' } },
          'Suas músicas seguem você: cada mudança sobe cifrada e aparece nos outros aparelhos quando abrirem o app com internet. Sem senha para inventar: o app cuida disso sozinho. No palco nada muda, tudo continua gravado no aparelho.'
        ),
        deviceInput,
        btn,
        claimBtn
      )
    } else {
      const quando = st.busy
        ? 'Sincronizando…'
        : st.error
          ? 'Falhou: ' + st.error
          : st.lastSyncAt
            ? 'Sincronizado às ' + fmtHora(st.lastSyncAt)
            : 'Aguardando a primeira sincronização'
      parts.push(
        h(
          'p',
          { className: 'hint', style: st.error && !st.busy ? { marginBottom: '10px', color: 'var(--red)' } : { marginBottom: '10px' } },
          `Ligada neste aparelho (${st.device}). ${quando}.`
        ),
        h(
          'p',
          { className: 'hint', style: { marginBottom: '10px' } },
          'Com o app aberto ele confere a nuvem sozinho a cada 45 segundos, e também ao voltar para o app. No palco fica quieto.'
        ),
        h(
          'button',
          {
            className: 'btn primary block',
            style: { marginBottom: '10px' },
            onClick: () => pairSheet(),
          },
          '＋ Conectar outro aparelho'
        ),
        h(
          'div',
          { className: 'row' },
          h(
            'button',
            {
              className: 'btn',
              style: { flex: '1' },
              onClick: () => {
                void pullNow()
              },
            },
            '↻ Sincronizar agora'
          ),
          h(
            'button',
            {
              className: 'btn',
              style: { flex: '1' },
              onClick: async () => {
                if (await confirmDialog('Desligar a sincronização neste aparelho? As músicas daqui continuam intactas.', 'Desligar')) {
                  await disableSync()
                  render()
                }
              },
            },
            'Desligar'
          )
        )
      )
    }
    wrap.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null))
  }

  const un = onSyncChange(() => {
    if (!wrap.isConnected) {
      un()
      return
    }
    render()
  })
  render()
  return wrap
}

export function moreScreen(): HTMLElement {
  const root = h('div', { className: 'screen' })
  root.append(topbar('Mais'))
  const content = h('div', { className: 'content' })

  const stats = `${store.songs.size} música${store.songs.size === 1 ? '' : 's'} · ${store.shows.size} show${store.shows.size === 1 ? '' : 's'} salvos neste iPad`

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } }) as HTMLInputElement
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      const result = await store.importData(await file.text())
      alertSheet('Backup importado', `Novas: ${result.addedSongs} · atualizadas: ${result.updatedSongs} · já existiam: ${result.skipped} · shows novos: ${result.addedShows}`)
    } catch (err) {
      alertSheet('Não deu certo', err instanceof Error ? err.message : 'Arquivo inválido.')
    }
    fileInput.value = ''
  })

  content.append(
    h('p', { className: 'hint', style: { marginBottom: '16px' } }, stats),
    h('h2', { style: { fontSize: '18px', margin: '8px 0' } }, 'Backup'),
    h('p', { className: 'hint', style: { marginBottom: '10px' } }, 'Exporte um arquivo com a biblioteca inteira (músicas, shows e ajustes) e guarde no iCloud ou envie para você mesmo. Importar recupera tudo.'),
    h(
      'div',
      { className: 'row', style: { marginBottom: '24px' } },
      h(
        'button',
        {
          className: 'btn',
          style: { flex: '1' },
          onClick: () => {
            const blob = new Blob([store.exportData()], { type: 'application/json' })
            const a = h('a', {
              href: URL.createObjectURL(blob),
              download: 'cifras-backup-' + new Date().toISOString().slice(0, 10) + '.json',
            }) as HTMLAnchorElement
            document.body.append(a)
            a.click()
            a.remove()
          },
        },
        '⬇ Exportar backup'
      ),
      h('button', { className: 'btn', style: { flex: '1' }, onClick: () => fileInput.click() }, '⬆ Importar backup')
    ),
    syncCard(),
    h('h2', { style: { fontSize: '18px', margin: '8px 0' } }, 'Importar cifras'),
    h('p', { className: 'hint', style: { marginBottom: '10px' } }, 'O botão "Copiar cifra" nos favoritos do navegador copia a cifra de qualquer site já com nome e artista; no app, Colar preenche tudo.'),
    h('button', { className: 'btn block', style: { marginBottom: '14px' }, onClick: () => navigate({ name: 'botao' }) }, 'Instalar o botão "Copiar cifra"'),
    h('h2', { style: { fontSize: '18px', margin: '8px 0' } }, 'Pedido surpresa'),
    h('p', { className: 'hint', style: { marginBottom: '10px' } }, 'Busca online para músicas fora da biblioteca (precisa de sinal).'),
    h('button', { className: 'btn block', style: { marginBottom: '24px' }, onClick: () => navigate({ name: 'planb', showId: null }) }, 'Abrir o Plano B'),
    h('p', { className: 'hint' }, 'Cifras · app pessoal do Eder · funciona offline · os dados vivem só neste aparelho: faça backup antes de trocar de iPad.'),
    fileInput
  )
  root.append(content)
  return root
}

// ---------- assistente de carga (o app conduz música a música) ----------

/** A música ainda está de esqueleto (sem cifra de verdade)? */
export function isSkeleton(song: Song): boolean {
  return song.body.includes('COLE A CIFRA AQUI') || song.body.trim() === ''
}

/** Escolhe o tom: o anunciado pela página, o declarado na cifra ou o adivinhado pelos acordes. */
function bestTom(fetched: FetchedCifra, fallback: string): string {
  if (fetched.tom && parseKey(fetched.tom)) return fetched.tom
  const parsed = parseCifra(fetched.body)
  if (parsed.tom && parseKey(parsed.tom)) return parsed.tom
  return guessTom(parsed) ?? fallback
}

function cifraSnippet(body: string, lines = 14): HTMLElement {
  const text = body.split('\n').slice(0, lines).join('\n')
  const pre = h('pre', {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '13px',
      lineHeight: '1.4',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '10px 12px',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      margin: '10px 0',
    },
  })
  pre.textContent = text + '\n…'
  return pre
}

/**
 * Busca dentro do app para UMA música: procura, lista os resultados,
 * mostra a prévia da escolhida e salva por cima da música existente.
 */
function inAppSearch(container: HTMLElement, current: Song, onSaved: () => void): void {
  const query = (current.artist + ' ' + current.title).trim() || current.title

  const statusLine = (msg: string) => h('p', { className: 'hint', style: { margin: '4px 0 10px' } }, msg)

  const showError = (msg: string) => {
    container.replaceChildren(
      h('div', { className: 'banner' }, msg),
      h('button', { className: 'btn small', onClick: () => start() }, 'Tentar de novo')
    )
  }

  const showResults = (hits: SearchHit[]) => {
    const list = h('div', { className: 'list' })
    for (const hit of hits.slice(0, 5)) {
      list.append(
        h(
          'button',
          { className: 'card', onClick: () => void showPreview(hit) },
          h('div', { className: 'grow' }, h('div', { className: 'title', style: { fontSize: '16px' } }, hit.title), h('div', { className: 'meta' }, hit.host)),
          h('span', { className: 'hint' }, '›')
        )
      )
    }
    container.replaceChildren(statusLine('Toque na versão que você quer usar:'), list)
  }

  const showPreview = async (hit: SearchHit) => {
    container.replaceChildren(statusLine('Lendo a cifra…'))
    let fetched: FetchedCifra
    try {
      fetched = await fetchCifraFromUrl(hit.url)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Não consegui ler essa página.')
      return
    }
    const parsed = parseCifra(fetched.body)
    const chordLines = parsed.blocks.flatMap((b) => b.lines).filter((l) => l.kind === 'chords').length
    if (chordLines < 2) {
      showError('Essa página não parece ter uma cifra legível. Tente outro resultado.')
      return
    }
    const tom = bestTom(fetched, current.tom)
    container.replaceChildren(
      h(
        'div',
        { className: 'row', style: { margin: '4px 0 2px' } },
        h('span', { className: 'badge' }, tom || '—'),
        h('span', { className: 'hint' }, 'fonte: ' + fetched.host)
      ),
      cifraSnippet(fetched.body),
      h(
        'button',
        {
          className: 'btn primary block',
          style: { minHeight: '60px', fontSize: '17px' },
          onClick: async () => {
            await store.updateSong(current.id, { body: fetched.body, tom, sourceUrl: fetched.sourceUrl })
            onSaved()
          },
        },
        '✓ Usar esta, próxima ›'
      ),
      h('button', { className: 'btn small block', style: { marginTop: '8px' }, onClick: () => start() }, '‹ Outros resultados')
    )
  }

  const start = () => {
    container.replaceChildren(statusLine(`Buscando "${query}"…`))
    searchCifras(query)
      .then((hits) => {
        if (hits.length === 0) showError('Nada encontrado para "' + query + '". Use o caminho manual aqui embaixo.')
        else showResults(hits)
      })
      .catch((err) => showError(err instanceof Error ? err.message : 'A busca falhou.'))
  }

  start()
}

let lastLoadedClip = ''

export function cargaScreen(showId: string): HTMLElement {
  const root = h('div', { className: 'screen' })
  const skipped = new Set<string>()

  const render = () => {
    root.replaceChildren()
    const show = store.shows.get(showId)
    if (!show) {
      navigate({ name: 'shows' })
      return
    }
    const all = show.items.map((it) => store.songs.get(it.songId)).filter((s): s is Song => !!s)
    const missing = all.filter((s) => isSkeleton(s))
    const queue = missing.filter((s) => !skipped.has(s.id)).concat(missing.filter((s) => skipped.has(s.id)))
    const done = all.length - missing.length

    root.append(topbar('Assistente de carga', { back: { name: 'show', id: showId } }))
    const content = h('div', { className: 'content' })

    content.append(
      h(
        'p',
        { className: 'hint', style: { marginBottom: '14px', fontSize: '16px' } },
        `${show.name}: `,
        h('b', { style: { color: 'var(--green)' } }, String(done)),
        ` de ${all.length} músicas com cifra`
      )
    )

    if (queue.length === 0) {
      content.append(
        h('div', { className: 'empty' }, h('div', { className: 'big' }, '🎉'), 'Todas as músicas do show estão com cifra. Bom ensaio!'),
        h('button', { className: 'btn primary block', onClick: () => navigate({ name: 'play', showId, idx: 0 }) }, '▶  Tocar o show')
      )
      root.append(content)
      return
    }

    const current = queue[0]!
    const error = h('div', { style: { display: 'none' } })
    const showError = (msg: string) => {
      error.replaceChildren(h('div', { className: 'banner' }, msg))
      error.style.display = 'block'
    }

    content.append(
      h(
        'div',
        { className: 'card', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px', marginBottom: '16px', padding: '18px' } },
        h('div', { className: 'meta' }, `Próxima (${done + 1} de ${all.length}):`),
        h('div', { style: { fontSize: '26px', fontWeight: '750' } }, current.title),
        h('div', { className: 'meta', style: { fontSize: '16px' } }, current.artist || ' ')
      )
    )

    // busca dentro do app: procura, mostra a prévia e salva sem sair da tela
    const searchBox = h('div', null)
    content.append(searchBox)
    inAppSearch(searchBox, current, () => {
      lastLoadedClip = ''
      render()
    })

    content.append(
      h('p', { className: 'hint', style: { margin: '20px 0 8px', fontWeight: '600' } }, 'Caminho manual, se a busca falhar:'),
      h(
        'button',
        {
          className: 'btn small',
          style: { marginBottom: '10px' },
          onClick: () => {
            const q = encodeURIComponent((current.artist + ' ' + current.title).trim())
            window.open('https://www.cifraclub.com.br/?q=' + q, '_blank')
          },
        },
        'Abrir a busca no site'
      ),
      h(
        'p',
        { className: 'hint', style: { margin: '0 0 10px' } },
        'Na página da cifra, toque no favorito "Copiar cifra" e volte para cá. ',
        h('a', { href: '#/botao', style: { color: 'var(--blue)' } }, 'Ainda não instalou o botão?')
      ),
      h(
        'button',
        {
          className: 'btn block',
          onClick: async () => {
            let text = ''
            try {
              text = await navigator.clipboard.readText()
            } catch {
              showError('Não consegui ler a área de transferência. Toque de novo e permita o acesso, ou use a edição manual da música.')
              return
            }
            if (!text.trim()) {
              showError('A área de transferência está vazia. Toque no favorito "Copiar cifra" na página da cifra antes de voltar.')
              return
            }
            if (text === lastLoadedClip) {
              showError('Isso é a mesma cifra da música anterior. Busque e copie a cifra desta música antes de colar.')
              return
            }
            const header = extractImportHeader(text)
            const body = header.body
            const parsed = parseCifra(body)
            const chordLines = parsed.blocks.flatMap((b) => b.lines).filter((l) => l.kind === 'chords').length
            if (chordLines < 2) {
              showError('O texto copiado não parece uma cifra (não achei linhas de acordes). Confira se copiou a página certa.')
              return
            }
            const tom = parsed.tom && parseKey(parsed.tom) ? parsed.tom : current.tom
            await store.updateSong(current.id, { body, tom })
            lastLoadedClip = text
            render()
          },
        },
        'Colar e salvar, próxima ›'
      ),
      error,
      h(
        'div',
        { className: 'row', style: { marginTop: '14px' } },
        h(
          'button',
          {
            className: 'btn small',
            style: { flex: '1' },
            onClick: () => {
              skipped.add(current.id)
              render()
            },
          },
          'Pular por enquanto'
        ),
        h('button', { className: 'btn small', style: { flex: '1' }, onClick: () => navigate({ name: 'edit', id: current.id }) }, 'Edição manual')
      )
    )

    if (queue.length > 1) {
      content.append(
        h(
          'p',
          { className: 'hint', style: { marginTop: '18px' } },
          'Na fila: ' + queue.slice(1, 4).map((s) => s.title).join(' · ') + (queue.length > 4 ? ` e mais ${queue.length - 4}` : '')
        )
      )
    }

    root.append(content)
  }

  render()
  return root
}

// ---------- busca avulsa dentro do app ----------

export function buscarScreen(showId: string | null): HTMLElement {
  const root = h('div', { className: 'screen' })
  const back: Route = showId ? { name: 'show', id: showId } : { name: 'library' }
  root.append(topbar('Buscar cifra', { back }))
  const content = h('div', { className: 'content' })

  const query = h('input', { placeholder: 'Nome da música e banda (ex.: Fátima Capital Inicial)' }) as HTMLInputElement
  const area = h('div', null)

  const showError = (msg: string) => {
    area.replaceChildren(h('div', { className: 'banner' }, msg))
  }

  const showPreview = async (hit: SearchHit) => {
    area.replaceChildren(h('p', { className: 'hint' }, 'Lendo a cifra…'))
    let fetched: FetchedCifra
    try {
      fetched = await fetchCifraFromUrl(hit.url)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Não consegui ler essa página.')
      return
    }
    const title = h('input', { value: fetched.title || query.value }) as HTMLInputElement
    const artist = h('input', { value: fetched.artist }) as HTMLInputElement
    const tom = tomSelect(bestTom(fetched, ''))
    const save = async (): Promise<Song> => {
      return await store.addSong({ title: title.value, artist: artist.value, tom: tom.value, body: fetched.body, sourceUrl: fetched.sourceUrl })
    }
    area.replaceChildren(
      h('div', { className: 'row', style: { margin: '4px 0 2px' } }, h('span', { className: 'badge' }, tom.value || '—'), h('span', { className: 'hint' }, 'fonte: ' + fetched.host)),
      cifraSnippet(fetched.body),
      h('div', { className: 'field' }, h('label', null, 'Nome'), title),
      h('div', { className: 'field' }, h('label', null, 'Artista'), artist),
      h('div', { className: 'field' }, h('label', null, 'Tom'), tom),
      showId
        ? h(
            'button',
            {
              className: 'btn primary block',
              onClick: async () => {
                const song = await save()
                const show = store.shows.get(showId)
                if (show) await store.updateShow(showId, { items: [...show.items, { songId: song.id }] })
                navigate({ name: 'show', id: showId })
              },
            },
            '✓ Salvar e colocar no show'
          )
        : h(
            'button',
            {
              className: 'btn primary block',
              onClick: async () => {
                const song = await save()
                navigate({ name: 'song', id: song.id })
              },
            },
            '✓ Salvar na biblioteca'
          ),
      h('button', { className: 'btn small block', style: { marginTop: '8px' }, onClick: () => doSearch() }, '‹ Outros resultados')
    )
  }

  const doSearch = () => {
    const q = query.value.trim()
    if (q.length < 2) {
      query.focus()
      return
    }
    area.replaceChildren(h('p', { className: 'hint' }, `Buscando "${q}"…`))
    searchCifras(q)
      .then((hits) => {
        if (hits.length === 0) {
          showError('Nada encontrado. Tente incluir o nome da banda, ou use a Nova música para colar manualmente.')
          return
        }
        const list = h('div', { className: 'list' })
        for (const hit of hits) {
          list.append(
            h(
              'button',
              { className: 'card', onClick: () => void showPreview(hit) },
              h('div', { className: 'grow' }, h('div', { className: 'title', style: { fontSize: '16px' } }, hit.title), h('div', { className: 'meta' }, hit.host)),
              h('span', { className: 'hint' }, '›')
            )
          )
        }
        area.replaceChildren(h('p', { className: 'hint', style: { marginBottom: '8px' } }, 'Toque na versão que você quer:'), list)
      })
      .catch((err) => showError(err instanceof Error ? err.message : 'A busca falhou.'))
  }

  query.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') doSearch()
  })

  content.append(
    h('div', { className: 'field' }, h('label', null, 'Qual música?'), query),
    h('button', { className: 'btn primary block', style: { marginBottom: '16px' }, onClick: () => doSearch() }, '🔍 Buscar'),
    area
  )
  root.append(content)
  return root
}

// ---------- botão de importar (bookmarklet) ----------

const BOOKMARKLET =
  'javascript:(function(){var s=String((window.getSelection&&window.getSelection())||"").trim();var best=s.length>80?s:"";if(!best){var ps=document.querySelectorAll("pre");for(var i=0;i<ps.length;i++){var t=(ps[i].innerText||"").trim();if(t.length>best.length)best=t}}if(!best)best=(document.body.innerText||"").trim();var ti=document.title.replace(/\\s*[|\\u2013\\u2014-]\\s*(Cifra Club|Cifras|Letras.*|Chords.*|Ultimate.*)\\s*$/i,"");var p=ti.split(/\\s[-\\u2013]\\s/);var song=(p[0]||"").trim();var art=(p[1]||"").trim();var out="M\\u00fasica: "+song+"\\nArtista: "+art+"\\n\\n"+best;function ok(){var d=document.createElement("div");d.textContent="Cifra copiada! Abra o app Cifras e toque em Colar.";d.setAttribute("style","position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:%230e1116;color:%23ffb454;padding:14px 20px;border-radius:12px;font:15px -apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)");document.body.appendChild(d);setTimeout(function(){d.remove()},2600)}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(out).then(ok,function(){window.prompt("Copie manualmente:",out)})}else{window.prompt("Copie manualmente:",out)}})();'

export function botaoScreen(): HTMLElement {
  const root = h('div', { className: 'screen' })
  root.append(topbar('O botão "Copiar cifra"', { back: { name: 'more' } }))
  const content = h('div', { className: 'content' })

  const code = h('textarea', { rows: 5, readOnly: true }) as HTMLTextAreaElement
  code.value = BOOKMARKLET

  const copyBtn = h(
    'button',
    {
      className: 'btn primary block',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(BOOKMARKLET)
          copyBtn.textContent = '✓ Código copiado'
          setTimeout(() => (copyBtn.textContent = '📋 Copiar código do botão'), 2000)
        } catch {
          code.focus()
          code.select()
        }
      },
    },
    '📋 Copiar código do botão'
  ) as HTMLButtonElement

  content.append(
    h(
      'p',
      { style: { lineHeight: '1.55', marginBottom: '14px' } },
      'É um favorito mágico do navegador: na página de qualquer cifra, toque nele e a cifra inteira é copiada já com nome da música e artista. Depois é só voltar ao app e tocar em Colar. Nada de selecionar texto.'
    ),
    h('div', { className: 'field' }, copyBtn),
    h('div', { className: 'field' }, h('label', null, 'Código do botão (se preferir copiar à mão)'), code),
    h('h2', { style: { fontSize: '17px', margin: '16px 0 8px' } }, 'Instalar no computador (Chrome), 1 minuto'),
    h(
      'p',
      { className: 'hint', style: { marginBottom: '14px' } },
      '1. Copie o código acima. 2. Mostre a barra de favoritos (Cmd+Shift+B). 3. Clique com o botão direito na barra → "Adicionar página…" → nome: Copiar cifra; URL: cole o código → Salvar. Pronto: abra uma cifra e clique no favorito.'
    ),
    h('h2', { style: { fontSize: '17px', margin: '16px 0 8px' } }, 'Instalar no iPad (Safari), 2 minutos'),
    h(
      'p',
      { className: 'hint', style: { marginBottom: '14px' } },
      '1. No Safari do iPad, salve qualquer página nos Favoritos com o nome "Copiar cifra" (compartilhar → Adicionar Favorito). 2. Abra esta tela no Safari do iPad e toque em Copiar código. 3. Toque no ícone de livro → Favoritos → Editar → "Copiar cifra" → apague o endereço, cole o código e confirme. Dica: se o Safari do Mac usa o mesmo iCloud, instale no Mac que ele aparece no iPad sozinho.'
    ),
    h(
      'p',
      { className: 'hint' },
      'Uso no palco ou em casa: buscar a música (botões de busca do app) → abrir a cifra → tocar no favorito "Copiar cifra" → voltar ao app → Colar. O botão funciona em qualquer site de cifra.'
    )
  )
  root.append(content)
  return root
}

function alertSheet(title: string, message: string): void {
  const close = sheet(h('h2', null, title), h('p', { style: { marginBottom: '14px' } }, message), h('button', { className: 'btn primary block', onClick: () => close() }, 'Ok'))
}
