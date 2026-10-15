// Prints how to run the app of the repository in the working directory for a demo, when its
// settings say (`demo.howToRun` in `.obeya/settings.json` on its default branch): the recipe a
// worker under Obeya finds in its brief. Run with Bun (`bun recipe.ts`), since it reads the settings.

import { readShared } from '../../../../src/adapters/index.ts';
import { repoInfo } from '../../../../src/server/repo.ts';

try {
  const howToRun = readShared(repoInfo(process.cwd()).path).settings?.demo?.howToRun;
  console.log(howToRun || 'No recipe for this repository: its own docs say how to start it.');
} catch (e) {
  console.log(`No recipe: ${e instanceof Error ? e.message : e}. Run it in the repository whose app the demo shows.`);
}
