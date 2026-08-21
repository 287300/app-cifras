// Leitura de palco: cifra em tela cheia com tela sempre acesa, rolagem
// automática por música, mudança de tom em 1 toque, fonte ajustável,
// lista de acordes e navegação entre músicas do show.

import { store, type Song } from '../store.ts'
import { h, sheet } from './dom.ts'
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
  constructor(
    private el: HTMLElement,
    public seconds: number,
    private onChange: (playing: boolean) => void
  ) {}

  toggle(): void {
    this.playing ? this.stop() : this.start()
  }

  start(): void {
    if (this.playing) return
    this.playing = true
    this.lastTs = 0
    this.onChange(true)
    const step = (ts: number) => {
      if (!this.playing) return
      if (this.lastTs > 0) {
        const dt = (ts - this.lastTs) / 1000
        const total = this.el.scrollHeight - this.el.clientHeight
        if (total > 0 && this.seconds > 0) {
          this.el.scrollTop += (total / this.seconds) * dt
          if (this.el.scrollTop >= total - 1) this.stop()
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

// ---------- leitura ----------

export function readerScreen(opts: ReaderOptions): HTMLElement {
  const root = h('div', { className: 'screen reader' })
  let scroller: AutoScroll | null = null

  void acquireWakeLock()

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
      h('div', { className: 'title' }, song.title),
      h('div', { className: 'meta' }, opts.subtitle ? opts.subtitle(opts.index) : song.artist || ' ')
    )
    const bar = h(
      'div',
      { className: 'readerbar' },
      h('button', { className: 'iconbtn', 'aria-label': 'Sair', onClick: () => opts.onExit() }, '✕'),
      title,
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

    // indicador e controle da rolagem
    const flag = h('button', { className: 'scrollflag' }, '▶ rolagem')
    scroller = new AutoScroll(content, entry.song.scrollSeconds || 180, (playing) => {
      flag.textContent = playing ? '❚❚ rolando' : '▶ rolagem'
      flag.classList.toggle('on', playing)
    })
    flag.addEventListener('click', (e) => {
      e.stopPropagation()
      scroller?.toggle()
    })

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

    // rodapé: posição no show, fonte e acordes
    const foot = h(
      'div',
      { className: 'playerfoot' },
      opts.entries.length > 1
        ? h('span', { className: 'hint', style: { minWidth: '64px' } }, `${opts.index + 1} / ${opts.entries.length}`)
        : h('span', { style: { minWidth: '64px' } }, ' '),
      h('div', { className: 'grow', style: { flex: '1' } }),
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
        opts.onEditCurrent
          ? h('button', { className: 'btn block', style: { marginTop: '10px' }, onClick: () => { close(); opts.onEditCurrent!() } }, 'Editar cifra')
          : null
      )
    }

    root.append(bar, content, ...zones, flag, foot)
  }

  renderCurrent()
  return root
}
