// Light or dark as the owner chose in the settings, else as the system: the stylesheets read it from
// `data-theme` on the page's root (styles.css, panel.css), so a choice applies without loading again.

import type { Theme } from '../core/types';
import { api } from './api';

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** The owner's choice from the server; one that does not answer leaves the system's. */
export const loadTheme = () => api.theme().then((v) => applyTheme(v.chosen), () => {});
