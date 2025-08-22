// src/useDashboardGlobalVars.ts
import { inject } from 'vue'

export const DASHBOARD_GLOBAL_VARS_KEY = 'dashboard:globalVars' as const
export type FilterValue = string | number | boolean | null | string[] | number[]
export type Filters = Record<string, FilterValue>

export type GlobalVarsShape = {
  apiUrl: string | import('vue').Ref<string>
  filters: Filters | import('vue').Ref<Filters>          // reactive bag
  setFilter: (key: string, value: FilterValue) => void   // mutate
  clearFilter: (key: string) => void
  resetFilters?: (next?: Filters) => void
}

export function useDashboardGlobalVars(required = false) {
  const gv = inject<GlobalVarsShape | null>(DASHBOARD_GLOBAL_VARS_KEY, null)
  if (!gv && required) {
    console.warn('[Widget] dashboard:globalVars not provided.')
  }
  return gv
}