// Rotas por hash: funcionam offline, sobrevivem a recarregar e não
// dependem do caminho em que o app está hospedado.

export type Route =
  | { name: 'shows' }
  | { name: 'show'; id: string }
  | { name: 'play'; showId: string; idx: number }
  | { name: 'library' }
  | { name: 'song'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'add'; to: string | null }
  | { name: 'planb'; showId: string | null }
  | { name: 'more' }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (parts[0]) {
    case undefined:
    case '':
    case 'shows':
      if (parts[1]) return { name: 'show', id: parts[1] }
      return { name: 'shows' }
    case 'play':
      if (parts[1]) return { name: 'play', showId: parts[1], idx: Math.max(0, parseInt(parts[2] ?? '0', 10) || 0) }
      return { name: 'shows' }
    case 'library':
      if (parts[1]) return { name: 'song', id: parts[1] }
      return { name: 'library' }
    case 'edit':
      if (parts[1]) return { name: 'edit', id: parts[1] }
      return { name: 'library' }
    case 'add':
      return { name: 'add', to: parts[1] ?? null }
    case 'planb':
      return { name: 'planb', showId: parts[1] ?? null }
    case 'more':
      return { name: 'more' }
    default:
      return { name: 'shows' }
  }
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'shows':
      return '#/shows'
    case 'show':
      return '#/shows/' + route.id
    case 'play':
      return '#/play/' + route.showId + '/' + route.idx
    case 'library':
      return '#/library'
    case 'song':
      return '#/library/' + route.id
    case 'edit':
      return '#/edit/' + route.id
    case 'add':
      return '#/add' + (route.to ? '/' + route.to : '')
    case 'planb':
      return '#/planb' + (route.showId ? '/' + route.showId : '')
    case 'more':
      return '#/more'
  }
}

export function navigate(route: Route): void {
  const path = routePath(route)
  if (location.hash === path) {
    // mesma rota: força a tela a se reconstruir (dados podem ter mudado)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = path
  }
}

export function replaceRoute(route: Route): void {
  history.replaceState(null, '', routePath(route))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function currentRoute(): Route {
  return parseHash(location.hash)
}

export function onRouteChange(fn: (route: Route) => void): void {
  window.addEventListener('hashchange', () => fn(currentRoute()))
}
