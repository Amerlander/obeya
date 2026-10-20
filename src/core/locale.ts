// The languages Obeya speaks: the demo skill's, which runs without Obeya and so holds them.
import { type Language, LANGUAGE_NAMES } from '../../plugin/skills/demo/lib/locale.ts';

export { FALLBACK_LANGUAGE, LANGUAGE_NAMES, LANGUAGES, type Language, languageOf } from '../../plugin/skills/demo/lib/locale.ts';

/**
 * What a prompt tells an agent that talks with the owner about the language it writes them in
 * (design: Language): the one of the owner's most recent words to it, else the conversation
 * language, or, where the owner wrote what the agent starts from (`first`), the language of that.
 * Its tools then say "in the owner's language".
 */
export const ownersLanguage = (conversation: Language, first?: string) =>
  `The owner's language is the one of their most recent words to you, typed or spoken (words that tell no language, such as an option's letter, a name or "ok", change nothing); until they have said anything, ${first ? `the language of ${first} (${LANGUAGE_NAMES[conversation]} where it tells none)` : LANGUAGE_NAMES[conversation]}. What you write to the owner is in the owner's language, also where what you work on is in another.`;

/** What a prompt tells an agent whose work lands in a repository about the language of what lands there. */
export const repositoryLanguage = (repository: Language) =>
  `What you commit (code, comments, commit messages, docs, plan docs, CLAUDE.md) is in ${LANGUAGE_NAMES[repository]}, whatever language the owner talks to you in.`;
