// Tipos mínimos para rodar sem dependências externas (registro npm indisponível
// no ambiente de build). Cobre apenas o que o projeto usa de "bun:test" e do
// runtime Bun nos scripts de build.

declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeNull(): void
    toBeDefined(): void
    toBeGreaterThan(n: number): void
    toBeGreaterThanOrEqual(n: number): void
    toBeLessThan(n: number): void
    toHaveLength(n: number): void
    toThrow(msg?: string): void
    not: Matchers
  }
  export function expect(value: unknown): Matchers
}

declare namespace Bun {
  function build(config: {
    entrypoints: string[]
    outdir?: string
    target?: 'browser' | 'bun' | 'node'
    format?: 'esm' | 'cjs' | 'iife'
    minify?: boolean
    naming?: string | { entry?: string }
    sourcemap?: 'none' | 'linked' | 'inline' | 'external'
  }): Promise<{ success: boolean; outputs: Array<{ path: string }>; logs: unknown[] }>
}
