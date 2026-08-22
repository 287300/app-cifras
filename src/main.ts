// Ponto de entrada: registra o service worker (offline), carrega o estado
// e liga o roteador às telas, com a barra de abas nas telas de lista.

import { currentRoute, navigate, onRouteChange, type Route } from './router.ts'
import { store } from './store.ts'
import { h, clear } from './ui/dom.ts'
import { addScreen, botaoScreen, buscarScreen, cargaScreen, editScreen, libraryScreen, moreScreen, planbScreen, playerScreen, showEditScreen, showsScreen, songScreen } from './ui/screens.ts'

const rootEl = document.getElementById('root')!

function tabbar(active: 'shows' | 'library' | 'more'): HTMLElement {
  const tab = (name: 'shows' | 'library' | 'more', icon: string, label: string, route: Route) =>
    h(
      'button',
      { className: active === name ? 'active' : '', onClick: () => navigate(route) },
      h('span', { className: 'ico' }, icon),
      label
    )
  return h(
    'div',
    { className: 'tabbar' },
    tab('shows', '🎤', 'Shows', { name: 'shows' }),
    tab('library', '🎼', 'Biblioteca', { name: 'library' }),
    tab('more', '⚙️', 'Mais', { name: 'more' })
  )
}

function render(route: Route): void {
  clear(rootEl as HTMLElement)
  switch (route.name) {
    case 'shows':
      rootEl.append(showsScreen(), tabbar('shows'))
      break
    case 'show':
      rootEl.append(showEditScreen(route.id))
      break
    case 'play':
      rootEl.append(playerScreen(route.showId, route.idx))
      break
    case 'library':
      rootEl.append(libraryScreen(), tabbar('library'))
      break
    case 'song':
      rootEl.append(songScreen(route.id))
      break
    case 'edit':
      rootEl.append(editScreen(route.id))
      break
    case 'add':
      rootEl.append(addScreen(route.to))
      break
    case 'planb':
      rootEl.append(planbScreen(route.showId))
      break
    case 'more':
      rootEl.append(moreScreen(), tabbar('more'))
      break
    case 'botao':
      rootEl.append(botaoScreen())
      break
    case 'carga':
      rootEl.append(cargaScreen(route.showId))
      break
    case 'buscar':
      rootEl.append(buscarScreen(route.showId))
      break
  }
}

async function boot(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js')
      // recarrega uma única vez quando uma versão nova assumir
      let reloaded = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return
        reloaded = true
        location.reload()
      })
      void reg.update()
    } catch {
      // sem service worker (ex.: rodando de file://): o app segue funcionando online
    }
  }

  await store.init()
  render(currentRoute())
  onRouteChange(render)
}

void boot()
