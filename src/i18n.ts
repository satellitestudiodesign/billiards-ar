import { create } from 'zustand'
import { drillEn, drillEs, en, es } from './i18n.labels'

export type Lang = 'en' | 'es'
export type Key = keyof typeof en

const dicts = { en, es }
const drillDicts = { en: drillEn, es: drillEs }

const stored = (localStorage.getItem('lang') as Lang | null) ?? (navigator.language.startsWith('es') ? 'es' : 'en')

interface I18nState {
  lang: Lang
  setLang(l: Lang): void
}

export const useI18n = create<I18nState>((set) => ({
  lang: stored,
  setLang(lang) {
    localStorage.setItem('lang', lang)
    set({ lang })
  },
}))

/** Non-reactive lookup for use outside React (e.g. the store). */
export function tr(key: Key): string {
  return dicts[useI18n.getState().lang][key]
}

/** Reactive translator hook — re-renders on language change. */
export function useT() {
  const lang = useI18n((s) => s.lang)
  return (key: Key) => dicts[lang][key]
}

/** Reactive drill name/description in the current language. */
export function useDrillText() {
  const lang = useI18n((s) => s.lang)
  return (id: string) => drillDicts[lang][id] ?? drillEn[id]
}
