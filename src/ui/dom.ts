// Ajudantes mínimos de DOM: criação de elementos com atributos e filhos.

type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (key === 'className') {
        el.className = String(value)
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value)
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(el.dataset, value)
      } else if (key in el && key !== 'list' && key !== 'form') {
        ;(el as unknown as Record<string, unknown>)[key] = value
      } else {
        el.setAttribute(key, String(value))
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

export function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/** Diálogo de confirmação próprio (nunca window.confirm). */
export function confirmDialog(message: string, confirmLabel = 'Excluir'): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (answer: boolean) => {
      box.remove()
      resolve(answer)
    }
    const box = h(
      'div',
      { className: 'confirmbox' },
      h('div', { className: 'backdrop', onClick: () => close(false) }),
      h(
        'div',
        { className: 'box' },
        h('p', null, message),
        h(
          'div',
          { className: 'row' },
          h('button', { className: 'btn', onClick: () => close(false) }, 'Cancelar'),
          h('button', { className: 'btn danger', onClick: () => close(true) }, confirmLabel)
        )
      )
    )
    document.body.append(box)
  })
}

/** Folha inferior; retorna função de fechar. */
export function sheet(...content: (Node | string | null | undefined | false)[]): () => void {
  return sheetComSaida(undefined, ...content)
}

/**
 * Folha inferior que AVISA quem a abriu quando some pelo toque fora.
 *
 * Toda folha do app fecha ao tocar no fundo escuro; é o gesto que a pessoa já
 * conhece. Quem espera uma resposta da folha (uma pergunta de sim ou não)
 * precisa saber desse toque, senão fica esperando para sempre uma resposta
 * que nunca vem.
 */
export function sheetComSaida(
  onSaida: (() => void) | undefined,
  ...content: (Node | string | null | undefined | false)[]
): () => void {
  let vivo = true
  const fecha = () => {
    if (!vivo) return
    vivo = false
    wrap.remove()
  }
  const wrap = h(
    'div',
    { className: 'sheetwrap' },
    h(
      'div',
      {
        className: 'backdrop',
        onClick: () => {
          if (!vivo) return
          fecha()
          onSaida?.()
        },
      }
    ),
    h('div', { className: 'sheet' }, h('div', { className: 'grab' }), ...content)
  )
  document.body.append(wrap)
  return fecha
}
