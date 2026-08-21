// Diagramas em SVG: braço do violão e teclas do teclado.

import type { GuitarShape } from '../engine/guitar.ts'
import { mod12, noteToPc } from '../engine/notes.ts'
import { svgEl } from './dom.ts'

const ACCENT = '#ffb454'
const LINE = '#9aa7b8'
const TEXT = '#e9edf2'
const DARK = '#0e1116'

/** Braço do violão: 6 cordas verticais, 5 casas visíveis. */
export function guitarDiagram(shape: GuitarShape, width = 140): SVGElement {
  const strings = 6
  const fretsShown = 5
  const positive = shape.frets.filter((f) => f > 0)
  const maxFret = positive.length > 0 ? Math.max(...positive) : 1
  const base = maxFret <= fretsShown ? 1 : Math.min(...positive)

  const pad = { top: 26, left: base > 1 ? 30 : 16, right: 12, bottom: 10 }
  const gridW = width - pad.left - pad.right
  const stringGap = gridW / (strings - 1)
  const fretGap = 26
  const height = pad.top + fretGap * fretsShown + pad.bottom

  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` })

  // cordas
  for (let s = 0; s < strings; s++) {
    const x = pad.left + s * stringGap
    svg.append(svgEl('line', { x1: x, y1: pad.top, x2: x, y2: pad.top + fretGap * fretsShown, stroke: LINE, 'stroke-width': 1 }))
  }
  // trastes (pestana do instrumento no topo quando base == 1)
  for (let f = 0; f <= fretsShown; f++) {
    const y = pad.top + f * fretGap
    svg.append(
      svgEl('line', {
        x1: pad.left,
        y1: y,
        x2: pad.left + gridW,
        y2: y,
        stroke: f === 0 && base === 1 ? TEXT : LINE,
        'stroke-width': f === 0 && base === 1 ? 4 : 1,
      })
    )
  }
  // número da casa quando o desenho começa acima da primeira
  if (base > 1) {
    const label = svgEl('text', { x: 4, y: pad.top + fretGap * 0.65, fill: TEXT, 'font-size': 12, 'font-family': 'sans-serif' })
    label.textContent = base + 'ª'
    svg.append(label)
  }
  // pestana
  if (shape.barre) {
    const row = shape.barre.fret - base
    if (row >= 0 && row < fretsShown) {
      const y = pad.top + (row + 0.5) * fretGap
      const x1 = pad.left + shape.barre.from * stringGap
      const x2 = pad.left + shape.barre.to * stringGap
      svg.append(svgEl('rect', { x: x1 - 7, y: y - 7, width: x2 - x1 + 14, height: 14, rx: 7, fill: ACCENT }))
    }
  }
  // bolinhas, cordas soltas e mudas
  shape.frets.forEach((fret, s) => {
    const x = pad.left + s * stringGap
    if (fret === -1) {
      const t = svgEl('text', { x, y: pad.top - 8, fill: LINE, 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'sans-serif' })
      t.textContent = 'x'
      svg.append(t)
      return
    }
    if (fret === 0) {
      svg.append(svgEl('circle', { cx: x, cy: pad.top - 12, r: 4.5, fill: 'none', stroke: TEXT, 'stroke-width': 1.5 }))
      return
    }
    const row = fret - base
    if (row < 0 || row >= fretsShown) return
    const y = pad.top + (row + 0.5) * fretGap
    const inBarre = shape.barre && fret === shape.barre.fret && s >= shape.barre.from && s <= shape.barre.to
    if (!inBarre) svg.append(svgEl('circle', { cx: x, cy: y, r: 7.5, fill: ACCENT }))
  })

  return svg
}

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]
const BLACK_AFTER_WHITE: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 } // índice da branca -> pc da preta à direita

/** Teclado com duas oitavas; destaca as notas do acorde (e o baixo com contorno). */
export function pianoDiagram(noteNames: string[], bassName: string | null, width = 210): SVGElement {
  const octaves = 2
  const whites = 7 * octaves
  const whiteW = width / whites
  const height = 86
  const blackW = whiteW * 0.62
  const blackH = height * 0.6

  // distribui as notas de forma ascendente a partir da primeira
  const pcs = noteNames.map((n) => noteToPc(n)).filter((p): p is number => p !== null)
  const marks = new Set<number>() // pc + 12 * oitava
  let prev = -1
  for (const pc of pcs) {
    let v = pc
    while (v <= prev) v += 12
    if (v >= 24) v -= 24
    marks.add(v)
    prev = v
  }
  const bassPc = bassName ? noteToPc(bassName) : null

  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` })
  // brancas
  for (let w = 0; w < whites; w++) {
    const pcAbs = WHITE_PCS[w % 7]! + 12 * Math.floor(w / 7)
    const on = marks.has(pcAbs)
    const isBass = bassPc !== null && mod12(pcAbs) === bassPc && !on
    svg.append(
      svgEl('rect', {
        x: w * whiteW,
        y: 0,
        width: whiteW,
        height,
        fill: on ? ACCENT : '#f4f6f8',
        stroke: isBass ? ACCENT : '#5a6676',
        'stroke-width': isBass ? 2.5 : 1,
      })
    )
  }
  // pretas
  for (let w = 0; w < whites; w++) {
    const within = w % 7
    const blackPc = BLACK_AFTER_WHITE[within]
    if (blackPc === undefined) continue
    const pcAbs = blackPc + 12 * Math.floor(w / 7)
    const on = marks.has(pcAbs)
    const isBass = bassPc !== null && mod12(pcAbs) === bassPc && !on
    svg.append(
      svgEl('rect', {
        x: (w + 1) * whiteW - blackW / 2,
        y: 0,
        width: blackW,
        height: blackH,
        rx: 2,
        fill: on ? ACCENT : DARK,
        stroke: isBass ? ACCENT : '#000',
        'stroke-width': isBass ? 2.5 : 1,
      })
    )
  }
  return svg
}
