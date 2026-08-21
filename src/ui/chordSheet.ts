// Folha inferior com o desenho do acorde: braço do violão + teclas do teclado
// + notas por extenso. Acorde sem shape mostra as notas calculadas.

import { chordNotes } from '../engine/chordNotes.ts'
import { guitarShape } from '../engine/guitar.ts'
import { h, sheet } from './dom.ts'
import { guitarDiagram, pianoDiagram } from './diagrams.ts'

export function openChordSheet(chordName: string, useFlats: boolean): void {
  const notes = chordNotes(chordName, useFlats)
  const shape = guitarShape(chordName)

  const diagrams = h('div', { className: 'diagrams' })
  if (shape) {
    diagrams.append(h('div', { className: 'diagram' }, guitarDiagram(shape), h('div', { className: 'lbl' }, 'Violão')))
  }
  if (notes) {
    diagrams.append(
      h('div', { className: 'diagram' }, pianoDiagram(notes.notes, notes.bass), h('div', { className: 'lbl' }, 'Teclado'))
    )
  }

  const notesLine = h('div', { className: 'notesline' })
  if (notes) {
    notesLine.append('Notas: ')
    notes.notes.forEach((n, i) => {
      if (i > 0) notesLine.append(' · ')
      notesLine.append(h('b', null, n))
    })
    if (notes.bass) {
      notesLine.append('  |  baixo: ')
      notesLine.append(h('b', null, notes.bass))
    }
  } else {
    notesLine.append('Acorde não reconhecido')
  }

  sheet(h('h2', { style: { textAlign: 'center' } }, chordName), diagrams, notesLine)
}
