import { create } from 'zustand'
import type { Side } from '../protocol'
import type { Uf2File, Uf2Role } from './uf2'
import type { WriteResult } from './writer'

export type Recipe = 'zmk' | 'diag' | 'single'

export interface StepState {
  done: boolean
  result?: WriteResult
  note?: string
  error?: boolean
}

interface FlashState {
  recipe: Recipe
  files: Uf2File[]
  codePy: Uint8Array | null
  steps: Record<Side, StepState[]>
  busy: string | null
  setRecipe: (r: Recipe) => void
  addFiles: (f: Uf2File[]) => void
  removeFile: (id: string) => void
  setRole: (id: string, role: Uf2Role) => void
  setCodePy: (b: Uint8Array) => void
  markStep: (side: Side, i: number, s: StepState) => void
  resetSide: (side: Side) => void
  setBusy: (b: string | null) => void
}

const blank = (): StepState[] => Array.from({ length: 6 }, () => ({ done: false }))

export const useFlash = create<FlashState>((set) => ({
  recipe: 'zmk',
  files: [],
  codePy: null,
  steps: { left: blank(), right: blank() },
  busy: null,
  setRecipe: (recipe) => set({ recipe, steps: { left: blank(), right: blank() } }),
  addFiles: (f) =>
    set((s) => {
      // Si llega un archivo con el mismo nombre, reemplaza al anterior
      const names = new Set(f.map((x) => x.name))
      return { files: [...s.files.filter((x) => !names.has(x.name)), ...f] }
    }),
  removeFile: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
  setRole: (id, role) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, role } : f)) })),
  setCodePy: (codePy) => set({ codePy }),
  markStep: (side, i, st) =>
    set((s) => {
      const list = [...s.steps[side]]
      list[i] = st
      return { steps: { ...s.steps, [side]: list } }
    }),
  resetSide: (side) => set((s) => ({ steps: { ...s.steps, [side]: blank() } })),
  setBusy: (busy) => set({ busy }),
}))
