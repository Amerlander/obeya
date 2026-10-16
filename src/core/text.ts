// Text cut to a length, for prompts, log lines and labels.

/** `s` cut to `n` characters, the last of them "…" when it was longer. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** `s` on one line: each run of whitespace one space. */
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
