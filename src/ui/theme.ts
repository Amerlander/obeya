// Light or dark as the owner chose in the settings, else as the system: the stylesheets read it from
// `data-theme` on the page's root (styles.css, panel.css), so a choice applies without loading again.
// A page loads it together with its language before it first renders.

import { FALLBACK_LANGUAGE, languageOf } from '../core/locale';
import type { Theme } from '../core/types';
import { api } from './api';
import { setLanguage } from './strings';

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** The owner's choice from the server; one that does not answer leaves the system's. */
export const loadTheme = () => api.theme().then((v) => applyTheme(v.chosen), () => {});

/**
 * The language and the look first, from the server (the owner's choice, else the system's), so a
 * page's first render is in them; a server that does not answer leaves the browser's.
 */
export async function loadLanguageAndTheme() {
  const [language] = await Promise.all([
    api.language().then(
      (l) => l.language,
      () => languageOf(navigator.language) ?? FALLBACK_LANGUAGE,
    ),
    loadTheme(),
  ]);
  setLanguage(language);
}
