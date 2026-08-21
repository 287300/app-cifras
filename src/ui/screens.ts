// Telas do app: shows e setlist, biblioteca, adicionar/editar música,
// busca plano B e mais (backup). A leitura de palco vive em reader.ts.

import { parseCifra } from '../engine/parse.ts'
import { transposeKey, parseKey } from '../engine/notes.ts'
import { navigate, type Route } from '../router.ts'
import { store, type Show, type Song } from '../store.ts'
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
          'button',
          { className: 'card', onClick: () => navigate({ name: 'song', id: song.id }) },
          h('div', { className: 'grow' }, h('div', { className: 'title' }, song.title), h('div', { className: 'meta' }, song.artist || ' ')),
          h('span', { className: 'badge' }, displayTom(song))
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
      className: 'btn',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText()
          if (text) {
            body.value = text
            afterPaste()
          }
        } catch {
          body.focus()
        }
      },
    },
    '📋 Colar da área de transferência'
  )

  const afterPaste = () => {
    const parsed = parseCifra(body.value)
    if (parsed.tom && parseKey(parsed.tom)) tom.value = parsed.tom
  }
  body.addEventListener('input', afterPaste)

  content.append(
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
  // colar por cima de um esqueleto: se o tom ainda não foi definido, detecta da colagem
  body.addEventListener('input', () => {
    if (tom.value) return
    const parsed = parseCifra(body.value)
    if (parsed.tom && parseKey(parsed.tom)) tom.value = parsed.tom
  })

  content.append(
    h('div', { className: 'field' }, h('label', null, 'Nome'), title),
    h('div', { className: 'field' }, h('label', null, 'Artista'), artist),
    h('div', { className: 'field' }, h('label', null, 'Tom'), tom),
    h('div', { className: 'field' }, h('label', null, 'Observações (aparecem destacadas na leitura)'), notes),
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

  const query = h('input', { placeholder: 'Nome da música (e artista, se souber)' }) as HTMLInputElement
  const body = h('textarea', { rows: 8, placeholder: 'Cole a cifra copiada aqui…' }) as HTMLTextAreaElement
  const title = h('input', { placeholder: 'Nome da música' }) as HTMLInputElement
  const tom = tomSelect('')

  body.addEventListener('input', () => {
    const parsed = parseCifra(body.value)
    if (parsed.tom && parseKey(parsed.tom)) tom.value = parsed.tom
    if (!title.value && query.value) title.value = query.value
  })

  content.append(
    h('div', { className: 'field' }, h('label', null, '1. Buscar a cifra'), query),
    h(
      'div',
      { className: 'row', style: { marginBottom: '18px' } },
      h(
        'button',
        {
          className: 'btn',
          style: { flex: '1' },
          onClick: () => {
            const q = encodeURIComponent(query.value.trim())
            if (q) window.open('https://www.cifraclub.com.br/?q=' + q, '_blank')
          },
        },
        'Cifra Club'
      ),
      h(
        'button',
        {
          className: 'btn',
          style: { flex: '1' },
          onClick: () => {
            const q = encodeURIComponent(query.value.trim() + ' cifra')
            if (query.value.trim()) window.open('https://www.google.com/search?q=' + q, '_blank')
          },
        },
        'Google'
      )
    ),
    h('div', { className: 'field' }, h('label', null, '2. Colar a cifra'), body),
    h('div', { className: 'field' }, h('label', null, 'Nome'), title),
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
          const song = await store.addSong({ title: title.value || query.value || 'Pedido surpresa', artist: '', tom: tom.value, body: body.value })
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
    h('h2', { style: { fontSize: '18px', margin: '8px 0' } }, 'Pedido surpresa'),
    h('p', { className: 'hint', style: { marginBottom: '10px' } }, 'Busca online para músicas fora da biblioteca (precisa de sinal).'),
    h('button', { className: 'btn block', style: { marginBottom: '24px' }, onClick: () => navigate({ name: 'planb', showId: null }) }, 'Abrir o Plano B'),
    h('p', { className: 'hint' }, 'Cifras · app pessoal do Eder · funciona offline · os dados vivem só neste aparelho: faça backup antes de trocar de iPad.'),
    fileInput
  )
  root.append(content)
  return root
}

function alertSheet(title: string, message: string): void {
  const close = sheet(h('h2', null, title), h('p', { style: { marginBottom: '14px' } }, message), h('button', { className: 'btn primary block', onClick: () => close() }, 'Ok'))
}
