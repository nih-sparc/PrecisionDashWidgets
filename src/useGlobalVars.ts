// src/useDashboardGlobalVars.ts
import { inject } from 'vue'

export const DASHBOARD_GLOBAL_VARS_KEY = 'dashboard:globalVars' as const
export type FilterValue = string | number | boolean | null | string[] | number[]
export type Filters = Record<string, FilterValue>

export type Services = Record<string, any>

export type GlobalVarsShape = {
  services: Services | import('vue').Ref<Services>
  filters: Filters | import('vue').Ref<Filters>
  setFilter: (key: string, value: FilterValue, isDisplayed?: boolean) => void
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