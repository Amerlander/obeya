// What Obeya hands a share script (the share command of a repository, run as a process of its
// own): it lives outside this repository and cannot import Obeya's files by a relative path, so it
// imports this module from the path in `OBEYA_KIT`.

export { repoName } from './generic';
export type { DemoSite, RepoInfo } from './types';
export { ARTIFACT_DIR, artifactFiles, artifactPageHtml, day, demoPageHtml, esc, PAGE_STYLE, PAGE_WORDS, type PageLanguage, withHeightReport } from '../server/demo-page';
