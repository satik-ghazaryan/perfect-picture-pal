import { useEffect, useSyncExternalStore } from "react";

export type LocaleCode = "hy" | "en" | "ru";

export type LocalizedText = {
  hy: string;
  en: string;
  ru: string;
};

const STORAGE_KEY = "ari-gnank-locale";

let locale: LocaleCode = "hy";
let hydrated = false;
const listeners = new Set<() => void>();

export function emptyLocalized(hy = ""): LocalizedText {
  return { hy, en: "", ru: "" };
}

export function localized(value: unknown, fallback = ""): LocalizedText {
  if (typeof value === "string") return { hy: value, en: "", ru: "" };
  if (value && typeof value === "object") {
    const raw = value as Partial<LocalizedText>;
    return {
      hy: typeof raw.hy === "string" ? raw.hy : fallback,
      en: typeof raw.en === "string" ? raw.en : "",
      ru: typeof raw.ru === "string" ? raw.ru : "",
    };
  }
  return emptyLocalized(fallback);
}

export function pickLocale(value: LocalizedText | string | null | undefined, lang: LocaleCode) {
  const text = localized(value);
  const chosen = text[lang].trim();
  if (chosen) return chosen;
  return text.hy.trim() || text.en.trim() || text.ru.trim();
}

export function hyText(value: LocalizedText | string | null | undefined) {
  return pickLocale(value, "hy");
}

export function columnsToLocalized(hy: string, en: string, ru: string): LocalizedText {
  return { hy, en, ru };
}

export function pickColumns(hy: string, en: string, ru: string, lang: LocaleCode) {
  return pickLocale({ hy, en, ru }, lang);
}

export function tourTitle(
  tour: { title_hy: string; title_en: string; title_ru: string },
  lang: LocaleCode = "hy",
) {
  return pickColumns(tour.title_hy, tour.title_en, tour.title_ru, lang);
}

export function tourDescription(
  tour: { description_hy: string; description_en: string; description_ru: string },
  lang: LocaleCode = "hy",
) {
  return pickColumns(tour.description_hy, tour.description_en, tour.description_ru, lang);
}

export function tourLocation(
  tour: { location_hy: string; location_en: string; location_ru: string },
  lang: LocaleCode = "hy",
) {
  return pickColumns(tour.location_hy, tour.location_en, tour.location_ru, lang);
}

export function trimLocalized(value: LocalizedText): LocalizedText {
  return { hy: value.hy.trim(), en: value.en.trim(), ru: value.ru.trim() };
}

export function useSiteLocale() {
  const lang = useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleServerSnapshot);
  useEffect(() => {
    hydrateLocale();
  }, []);
  return lang;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function hydrateLocale() {
  if (hydrated || typeof localStorage === "undefined") return;
  hydrated = true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "hy" || raw === "en" || raw === "ru") {
    locale = raw;
    emit();
  }
}

export function setSiteLocale(next: LocaleCode) {
  locale = next;
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  emit();
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocaleSnapshot() {
  return locale;
}

export function getLocaleServerSnapshot(): LocaleCode {
  return "hy";
}
