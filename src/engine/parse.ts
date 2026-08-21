// Parser de cifra colada (formato brasileiro: linha de acordes sobre a letra),
// tolerante à sujeira de colagem do Cifra Club: título, "Tom:", "Afinação:",
// decorações como (x2) e tablaturas.

import { isChordToken } from './chord.ts'
import { parseKey } from './notes.ts'

export interface ChordItem {
  text: string
  col: number
  chord: boolean
}

export type SongLine =
  | { kind: 'chords'; items: ChordItem[] }
  | { kind: 'lyric'; text: string }
  | { kind: 'tab'; text: string }
  | { kind: 'blank' }

export interface Block {
  label: string | null
  lines: SongLine[]
}

export interface ParsedSong {
  tom: string | null
  blocks: Block[]
}

const TOM_RE = /^tom\s*:\s*(\S+)/i
const DISCARD_RE = /^afina[cç][aã]o\s*:/i
const SECTION_BRACKET_RE = /^\[([^\]]{1,40})\]\s*(.*)$/
const SECTION_COLON_RE = /^([A-Za-zÀ-úçÇ0-9ªº°\- ]{2,30}):$/
const TAB_RE = /^[eEBGDAa][b#]?\|/
const DECO_RE = /^(\(?\d*x\d*\)?|\|+|%|-+)$/i

/** Uma linha é de acordes? Todos os tokens são acordes ou decorações, com ao menos um acorde. */
function classifyTokens(line: string): ChordItem[] | null {
  const items: ChordItem[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  let chords = 0
  while ((m = re.exec(line)) !== null) {
    const text = m[0]
    const chord = isChordToken(text)
    const deco = DECO_RE.test(text)
    if (!chord && !deco) return null
    if (chord) chords++
    items.push({ text, col: m.index, chord })
  }
  if (chords === 0) return null
  return items
}

/** Interpreta o texto colado como cifra estruturada. */
export function parseCifra(raw: string): ParsedSong {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const lines = text.split('\n')

  let tom: string | null = null
  const blocks: Block[] = []
  let current: Block = { label: null, lines: [] }

  const pushBlock = () => {
    while (current.lines.length > 0 && current.lines[current.lines.length - 1]!.kind === 'blank') {
      current.lines.pop()
    }
    if (current.lines.length > 0 || current.label) blocks.push(current)
  }

  const addLine = (line: SongLine) => {
    if (line.kind === 'blank') {
      const last = current.lines[current.lines.length - 1]
      if (!last || last.kind === 'blank') return // colapsa vazias e ignora no início
    }
    current.lines.push(line)
  }

  const processContent = (line: string) => {
    const trimmed = line.trim()
    if (trimmed === '') {
      addLine({ kind: 'blank' })
      return
    }
    if (TAB_RE.test(trimmed)) {
      addLine({ kind: 'tab', text: line.replace(/\s+$/, '') })
      return
    }
    const items = classifyTokens(line.replace(/\s+$/, ''))
    if (items) {
      addLine({ kind: 'chords', items })
      return
    }
    addLine({ kind: 'lyric', text: line.replace(/\s+$/, '') })
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    const tomM = TOM_RE.exec(trimmed)
    if (tomM && tom === null && parseKey(tomM[1]!.replace(/[^A-Gb#m]/g, ''))) {
      tom = tomM[1]!.replace(/[^A-Gb#m]/g, '')
      continue
    }
    if (DISCARD_RE.test(trimmed)) continue

    const bracket = SECTION_BRACKET_RE.exec(trimmed)
    if (bracket) {
      pushBlock()
      current = { label: bracket[1]!.trim(), lines: [] }
      if (bracket[2] && bracket[2].trim() !== '') processContent(bracket[2])
      continue
    }
    const colon = SECTION_COLON_RE.exec(trimmed)
    if (colon && !isChordToken(colon[1]!.trim())) {
      pushBlock()
      current = { label: colon[1]!.trim(), lines: [] }
      continue
    }

    processContent(rawLine)
  }
  pushBlock()

  return { tom, blocks }
}

/** Reconstrói a linha de acordes com as colunas originais. */
export function renderChordLine(line: { kind: 'chords'; items: ChordItem[] }): string {
  let out = ''
  for (const item of line.items) {
    const col = Math.max(item.col, out.length === 0 ? 0 : out.length + 1)
    out = out.padEnd(col, ' ') + item.text
  }
  return out
}

/** Acordes únicos da música, na ordem em que aparecem. */
export function uniqueChords(song: ParsedSong): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const block of song.blocks) {
    for (const line of block.lines) {
      if (line.kind !== 'chords') continue
      for (const item of line.items) {
        if (item.chord && !seen.has(item.text)) {
          seen.add(item.text)
          out.push(item.text)
        }
      }
    }
  }
  return out
}
