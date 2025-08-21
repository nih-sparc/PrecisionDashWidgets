// src/useDashboardGlobalVars.ts
import { inject } from 'vue'

export const DASHBOARD_GLOBAL_VARS_KEY = 'dashboard:globalVars' as const

export type GlobalVarsShape = {
  apiUrl: string
  theme?: 'light' | 'dark'
  setTheme?: (t: 'light' | 'dark') => void
}

export function useDashboardGlobalVars(required = false) {
  const gv = inject<GlobalVarsShape | null>(DASHBOARD_GLOBAL_VARS_KEY, null)
  if (!gv && required) {
    console.warn('[Widget] dashboard:globalVars not provided.')
  }
  return gv
}
