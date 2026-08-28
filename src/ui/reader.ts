// Leitura de palco: cifra em tela cheia com tela sempre acesa, rolagem
// automática por música, mudança de tom em 1 toque, fonte ajustável,
// lista de acordes e navegação entre músicas do show.

import { store, type Song } from '../store.ts'
import { searchVideos, videoIdFromUrl } from '../importer.ts'
import { confirmDialog, h, sheet } from './dom.ts'
import { renderCifra } from './cifraView.ts'
import { openChordSheet } from './chordSheet.ts'

export interface ReaderEntry {
  song: Song
  semitones: number
  onSemitones: (n: number) => void
}

export interface ReaderOptions {
  entries: ReaderEntry[]
  index: number
  onIndex: (idx: number) => void
  onExit: () => void
  subtitle?: (idx: number) => string
  onEditCurrent?: () => void
}

// ---------- tela sempre acesa ----------

let wakeLock: { release(): Promise<void> } | null = null
let wakeWanted = false

async function acquireWakeLock(): Promise<void> {
  wakeWanted = true
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request('screen')
  } catch {
    wakeLock = null
  }
}

export function releaseWakeLock(): void {
  wakeWanted = false
  wakeLock?.release().catch(() => undefined)
  wakeLock = null
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeWanted) void acquireWakeLock()
})

// ---------- rolagem automática ----------

class AutoScroll {
  playing = false
  private raf = 0
  private lastTs = 0
  private progress = 0 // posição acumulada em px (permite passo menor que 1px por quadro)
  constructor(
    private el: HTMLElement,
    public seconds: number,
    private onChange: (playing: boolean) => void,
    private onNoScroll: () => void
  ) {}

  toggle(): void {
    this.playing ? this.stop() : this.start()
  }

  start(): void {
    if (this.playing) return
    const total = this.el.scrollHeight - this.el.clientHeight
    if (total <= 8) {
      // a cifra cabe inteira na tela: nada para rolar
      this.onNoScroll()
      return
    }
    // no fim (ou perto), recomeça do topo
    if (this.el.scrollTop >= total - 6) this.el.scrollTop = 0
    this.playing = true
    this.lastTs = 0
    this.progress = this.el.scrollTop
    this.onChange(true)
    const step = (ts: number) => {
      if (!this.playing) return
      if (this.lastTs > 0) {
        const dt = (ts - this.lastTs) / 1000
        const totalNow = this.el.scrollHeight - this.el.clientHeight
        if (totalNow > 0 && this.seconds > 0) {
          // velocidade da música, com um piso visível (cifra curta termina antes, sem problema)
          const rate = Math.max(totalNow / this.seconds, 10)
          // se o usuário arrastou a tela, segue do ponto novo
          if (Math.abs(this.el.scrollTop - this.progress) > 24) this.progress = this.el.scrollTop
          this.progress += rate * dt
          this.el.scrollTop = this.progress
          if (this.el.scrollTop >= totalNow - 1) this.stop()
        }
      }
      this.lastTs = ts
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  stop(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.onChange(false)
  }
}

// ---------- clipe para ensaiar junto ----------

/** Player do YouTube embutido, 16 por 9, com os controles do próprio player. */
function videoFrame(id: string): HTMLElement {
  const wrap = h('div', { className: 'videoframe' })
  const frame = h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&autoplay=1`,
    title: 'Clipe da música',
    allow: 'accelerometer; autoplay; encrypted-media; picture-in-picture',
    allowFullscreen: true,
    frameBorder: '0',
  })
  wrap.append(frame)
  return wrap
}

/** Folha de escolha do clipe: busca sozinha e aceita link colado. */
function chooseVideoSheet(song: Song, onPick: (id: string) => void): void {
  const list = h('div', { className: 'list', style: { marginTop: '12px' } })
  const status = h('p', { className: 'hint' }, 'Procurando o clipe…')
  const urlInput = h('input', {
    type: 'text',
    placeholder: 'ou cole o link do YouTube',
    style: { marginTop: '14px' },
  }) as HTMLInputElement
  const close = sheet(
    h('h2', null, 'Vídeo de ' + song.title),
    status,
    list,
    urlInput,
    h(
      'button',
      {
        className: 'btn block',
        style: { marginTop: '10px' },
        onClick: () => {
          const id = videoIdFromUrl(urlInput.value)
          if (!id) {
            status.textContent = 'Esse link não parece do YouTube.'
            return
          }
          close()
          onPick(id)
        },
      },
      'Usar este link'
    )
  )

  void (async () => {
    try {
      const hits = await searchVideos((song.artist + ' ' + song.title).trim() || song.title)
      if (hits.length === 0) {
        status.textContent = 'Nada encontrado. Cole o link do YouTube abaixo.'
        return
      }
      status.textContent = 'Toque no vídeo que você quer ensaiar junto:'
      for (const hit of hits) {
        list.append(
          h(
            'button',
            {
              className: 'card',
              onClick: () => {
                close()
                onPick(hit.id)
              },
            },
            h(
              'div',
              { className: 'grow' },
              h('div', { className: 'title' }, hit.title),
              h('div', { className: 'meta' }, [hit.channel, hit.length].filter(Boolean).join(' · '))
            )
          )
        )
      }
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Não deu para buscar agora.'
    }
  })()
}

// ---------- leitura ----------

export function readerScreen(opts: ReaderOptions): HTMLElement {
  const root = h('div', { className: 'screen reader' })
  let scroller: AutoScroll | null = null
  // ligações para o teclado e o pedal de virar página (preenchidas a cada música)
  let goRef: (delta: number) => void = () => undefined
  let speedRef: (dir: 1 | -1) => void = () => undefined
  let videoOpen = false // o painel do clipe segue aberto ao trocar de música

  void acquireWakeLock()

  // Teclado e pedal Bluetooth: espaço liga e pausa a rolagem, setas trocam de
  // música e as setas de cima e de baixo mudam a velocidade. Os pedais de
  // virar página mandam justamente essas teclas.
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey)
      return
    }
    const target = e.target as HTMLElement | null
    if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    switch (e.key) {
      case ' ':
      case 'Spacebar':
      case 'Enter':
        e.preventDefault()
        scroller?.toggle()
        break
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault()
        goRef(1)
        break
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault()
        goRef(-1)
        break
      case 'ArrowUp':
        e.preventDefault()
        speedRef(1)
        break
      case 'ArrowDown':
        e.preventDefault()
        speedRef(-1)
        break
      case 'Escape':
        // com uma folha aberta (ex.: corrigindo a cifra), Esc fecha a folha:
        // sair do show no meio de uma correção perderia o texto digitado
        if (document.querySelector('.sheetwrap')) return
        e.preventDefault()
        opts.onExit()
        break
    }
  }
  document.addEventListener('keydown', onKey)

  const renderCurrent = () => {
    scroller?.stop()
    root.replaceChildren()
    const entry = opts.entries[opts.index]
    if (!entry) {
      opts.onExit()
      return
    }
    const { song, semitones } = entry
    const cifra = renderCifra(song, semitones)

    // barra superior
    const tomChip = h('span', { className: 'badge' }, cifra.displayTom ?? '—')
    const title = h(
      'div',
      { className: 't' },
      h('div', { className: 'title nowplaying' }, song.title),
      h('div', { className: 'meta' }, opts.subtitle ? opts.subtitle(opts.index) : song.artist || ' ')
    )
    // botão do clipe: abre o vídeo ao lado da cifra para ensaiar junto
    const videoBtn = h(
      'button',
      {
        className: 'iconbtn' + (videoOpen ? ' on' : ''),
        'aria-label': videoOpen ? 'Fechar o vídeo' : 'Vídeo da música',
        onClick: () => {
          if (videoOpen) {
            videoOpen = false
            renderCurrent()
            return
          }
          const saved = entry.song.videoId
          if (saved) {
            videoOpen = true
            renderCurrent()
            return
          }
          chooseVideoSheet(entry.song, (id) => {
            void store.updateSong(song.id, { videoId: id }).then(() => {
              entry.song = store.songs.get(song.id) ?? entry.song
              videoOpen = true
              renderCurrent()
            })
          })
        },
      },
      '🎬'
    )

    const bar = h(
      'div',
      { className: 'readerbar' },
      h('button', { className: 'iconbtn', 'aria-label': 'Sair', onClick: () => opts.onExit() }, '✕'),
      title,
      videoBtn,
      h('button', { className: 'iconbtn', 'aria-label': 'Descer meio tom', onClick: () => changeTone(-1) }, '♭'),
      tomChip,
      h('button', { className: 'iconbtn', 'aria-label': 'Subir meio tom', onClick: () => changeTone(1) }, '♯'),
      h('button', { className: 'iconbtn', 'aria-label': 'Opções', onClick: () => openOptions() }, '⋯')
    )

    const changeTone = (delta: number) => {
      entry.onSemitones(entry.semitones + delta)
      entry.semitones += delta
      renderCurrent()
    }

    // conteúdo com fonte ajustável
    const content = h('div', { className: 'content' }, cifra.el)
    content.style.fontSize = Math.round(17 * store.settings.fontScale) + 'px'
    content.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('.chord')) return
      scroller?.toggle()
    })

    // controles da rolagem: liga/pausa e velocidade (− / ＋), salva por música
    const baseline = entry.song.scrollSeconds || 180
    const flag = h('button', { className: 'scrollflag' }, '▶ rolagem')
    const updateFlag = () => {
      const speedX = baseline / (scroller?.seconds ?? baseline)
      const extra = Math.abs(speedX - 1) < 0.05 ? '' : ' ' + speedX.toFixed(1).replace('.', ',') + '×'
      flag.textContent = (scroller?.playing ? '❚❚ rolando' : '▶ rolagem') + extra
      flag.classList.toggle('on', !!scroller?.playing)
    }
    scroller = new AutoScroll(content, baseline, updateFlag, () => {
      flag.textContent = 'cifra inteira na tela'
      flag.classList.remove('on')
      setTimeout(updateFlag, 2000)
    })
    flag.addEventListener('click', (e) => {
      e.stopPropagation()
      scroller?.toggle()
    })
    const changeSpeed = (dir: 1 | -1) => {
      if (!scroller) return
      const next = Math.max(20, Math.min(900, Math.round(dir > 0 ? scroller.seconds / 1.15 : scroller.seconds * 1.15)))
      scroller.seconds = next
      void store.updateSong(song.id, { scrollSeconds: next })
      const fresh = store.songs.get(song.id)
      if (fresh) entry.song = fresh
      updateFlag()
    }
    speedRef = changeSpeed
    const slower = h('button', { className: 'scrollbtn', 'aria-label': 'Rolagem mais devagar' }, '−')
    const faster = h('button', { className: 'scrollbtn', 'aria-label': 'Rolagem mais rápida' }, '＋')
    slower.addEventListener('click', (e) => {
      e.stopPropagation()
      changeSpeed(-1)
    })
    faster.addEventListener('click', (e) => {
      e.stopPropagation()
      changeSpeed(1)
    })
    const scrollCtl = h('div', { className: 'scrollctl' }, slower, flag, faster)

    // zonas de navegação nas bordas (anterior / próxima)
    const zones: HTMLElement[] = []
    if (opts.entries.length > 1) {
      const left = h('button', { className: 'navzone left', 'aria-label': 'Música anterior' }, '‹')
      const right = h('button', { className: 'navzone right', 'aria-label': 'Próxima música' }, '›')
      left.addEventListener('click', (e) => {
        e.stopPropagation()
        go(-1)
      })
      right.addEventListener('click', (e) => {
        e.stopPropagation()
        go(1)
      })
      zones.push(left, right)
    }

    const go = (delta: number) => {
      const next = opts.index + delta
      if (next < 0 || next >= opts.entries.length) return
      opts.index = next
      opts.onIndex(next)
      renderCurrent()
    }
    goRef = go

    // rodapé: posição no show, fonte e acordes
    // botão explícito de troca de música no palco: "› próxima" com o nome dela
    const multi = opts.entries.length > 1
    const nextEntry = opts.entries[opts.index + 1]
    const prevBtn = multi
      ? h(
          'button',
          {
            className: 'iconbtn',
            'aria-label': 'Música anterior',
            disabled: opts.index === 0,
            style: opts.index === 0 ? { opacity: '0.35' } : null,
            onClick: (e: Event) => {
              e.stopPropagation()
              go(-1)
            },
          },
          '‹'
        )
      : null
    const nextBtn = multi
      ? h(
          'button',
          {
            className: 'btn nextbtn',
            'aria-label': nextEntry ? 'Próxima música: ' + nextEntry.song.title : 'Última música do show',
            disabled: !nextEntry,
            onClick: (e: Event) => {
              e.stopPropagation()
              go(1)
            },
          },
          h('span', { className: 'nextcap' }, 'próxima'),
          h('span', { className: 'nextlabel' }, nextEntry ? nextEntry.song.title : 'última música'),
          h('span', { className: 'nextarrow' }, '›')
        )
      : null

    const foot = h(
      'div',
      { className: 'playerfoot' },
      prevBtn,
      multi ? h('span', { className: 'hint', style: { flex: 'none' } }, `${opts.index + 1}/${opts.entries.length}`) : null,
      nextBtn,
      multi ? null : h('div', { className: 'grow', style: { flex: '1' } }),
      h(
        'button',
        {
          className: 'btn small',
          onClick: () => {
            const chords = cifra.chords
            const chips = h('div', { className: 'chips' })
            for (const c of chords) {
              chips.append(h('button', { className: 'chip', onClick: () => openChordSheet(c, cifra.useFlats) }, c))
            }
            sheet(h('h2', null, 'Acordes de ' + song.title), chords.length ? chips : h('p', { className: 'hint' }, 'Nenhum acorde reconhecido.'))
          },
        },
        'Acordes'
      ),
      h(
        'button',
        {
          className: 'btn small',
          'aria-label': 'Diminuir fonte',
          onClick: async () => {
            await store.setSettings({ fontScale: Math.max(0.7, store.settings.fontScale - 0.1) })
            content.style.fontSize = Math.round(17 * store.settings.fontScale) + 'px'
          },
        },
        'A−'
      ),
      h(
        'button',
        {
          className: 'btn small',
          'aria-label': 'Aumentar fonte',
          onClick: async () => {
            await store.setSettings({ fontScale: Math.min(2.2, store.settings.fontScale + 0.1) })
            content.style.fontSize = Math.round(17 * store.settings.fontScale) + 'px'
          },
        },
        'A+'
      )
    )

    /**
     * Correção da cifra sem sair da leitura: o erro aparece no ensaio, o
     * conserto tem de ser ali. Volta na mesma música e na mesma altura.
     */
    const abreEditor = () => {
      scroller?.stop()
      const altura = content.scrollTop
      const corpo = h('textarea', { className: 'editorcifra', rows: 18, spellcheck: false }) as HTMLTextAreaElement
      corpo.value = entry.song.body
      const obs = h('textarea', { rows: 2, placeholder: 'Observações suas (ex.: entra só no 2º verso)' }) as HTMLTextAreaElement
      obs.value = entry.song.notes
      const aviso =
        semitones !== 0
          ? h(
              'p',
              { className: 'hint', style: { marginBottom: '10px' } },
              `Você edita a cifra no tom original (${song.tom || 'sem tom'}). O ${semitones > 0 ? '+' : ''}${semitones} meio-tom deste show continua sendo aplicado por cima na leitura.`
            )
          : null
      const fecha = sheet(
        h('h2', null, 'Corrigir a cifra'),
        aviso,
        h('div', { className: 'field' }, h('label', null, 'Cifra de ' + song.title), corpo),
        h('div', { className: 'field' }, h('label', null, 'Observações'), obs),
        opts.onEditCurrent
          ? h(
              'button',
              {
                className: 'btn block',
                onClick: () => {
                  fecha()
                  opts.onEditCurrent!()
                },
              },
              'Abrir a edição completa (nome, artista, tom)'
            )
          : null,
        h(
          'div',
          { className: 'acoes' },
          h(
            'button',
            {
              className: 'btn primary block',
              onClick: async () => {
                await store.updateSong(song.id, { body: corpo.value, notes: obs.value })
                entry.song = store.songs.get(song.id) ?? entry.song
                fecha()
                renderCurrent()
                // volta para a mesma altura da tela: quem corrigiu quer continuar dali
                const novo = root.querySelector('.content')
                if (novo) novo.scrollTop = altura
              },
            },
            'Salvar a correção'
          ),
          h('button', { className: 'btn block', style: { marginTop: '10px' }, onClick: () => fecha() }, 'Cancelar')
        )
      )
      setTimeout(() => corpo.focus(), 120)
    }

    const openOptions = () => {
      const secondsInput = h('input', {
        type: 'number',
        inputMode: 'numeric',
        value: String(entry.song.scrollSeconds || 180),
        min: '20',
        max: '900',
      }) as HTMLInputElement
      const close = sheet(
        h('h2', null, 'Rolagem desta música'),
        h(
          'div',
          { className: 'field' },
          h('label', null, 'Duração da rolagem, em segundos (o tempo da música)'),
          secondsInput
        ),
        h(
          'button',
          {
            className: 'btn primary block',
            onClick: async () => {
              const v = Math.max(20, Math.min(900, parseInt(secondsInput.value, 10) || 180))
              await store.updateSong(song.id, { scrollSeconds: v })
              entry.song = store.songs.get(song.id) ?? song
              if (scroller) scroller.seconds = v
              close()
            },
          },
          'Salvar'
        ),
        h(
          'button',
          {
            className: 'btn block',
            style: { marginTop: '10px' },
            onClick: () => {
              close()
              abreEditor()
            },
          },
          '✏️ Corrigir a cifra'
        ),
        h(
          'button',
          {
            className: 'btn danger block',
            style: { marginTop: '10px' },
            onClick: async () => {
              close()
              if (await confirmDialog(`Excluir "${song.title}"? Sai da biblioteca e de todos os shows.`)) {
                await store.deleteSong(song.id)
                opts.onExit()
              }
            },
          },
          'Excluir música'
        )
      )
    }

    // painel do clipe (só no ensaio; no palco fica desligado e nem carrega)
    root.classList.toggle('withvideo', videoOpen && !!entry.song.videoId)
    const videoPane = videoOpen && entry.song.videoId ? h('div', { className: 'videopane' }) : null
    if (videoPane && entry.song.videoId) {
      videoPane.append(
        videoFrame(entry.song.videoId),
        h(
          'div',
          { className: 'videoacts' },
          h(
            'button',
            {
              className: 'btn small',
              onClick: () =>
                chooseVideoSheet(entry.song, (id) => {
                  void store.updateSong(song.id, { videoId: id }).then(() => {
                    entry.song = store.songs.get(song.id) ?? entry.song
                    renderCurrent()
                  })
                }),
            },
            'Trocar vídeo'
          ),
          h(
            'button',
            {
              className: 'btn small',
              onClick: () => {
                videoOpen = false
                renderCurrent()
              },
            },
            'Fechar vídeo'
          )
        )
      )
    }

    root.append(bar, ...(videoPane ? [videoPane] : []), content, ...zones, scrollCtl, foot)
  }

  renderCurrent()
  return root
}
