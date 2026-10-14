// The Chromium the plugin's skills drive: the demo skill records with it, the browser skill checks
// pages with it. Plain Node with type stripping, like the skills that import it; importing this
// module is what resolves Playwright, found up the tree from here (the checkout's node_modules, or
// the one beside the plugin among Obeya's resources and on a host).

import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

/**
 * Chromium launched by Playwright: `DEMO_CHROME` when set (the path of any Chromium-based browser),
 * else Chrome where it is installed, else Edge (on every Windows), else Playwright's own Chromium
 * (on Linux on ARM, where there is no Chrome).
 */
export async function launchChromium(options: LaunchOptions = {}): Promise<Browser> {
  if (process.env.DEMO_CHROME) return chromium.launch({ ...options, executablePath: process.env.DEMO_CHROME });
  const missing: string[] = [];
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ ...options, channel });
    } catch (error) {
      const message = String((error as Error).message);
      if (!/is not found at|Executable doesn't exist|not supported on/i.test(message)) throw error;
      missing.push(channel ?? 'chromium');
    }
  }
  throw new Error(
    `no browser (tried ${missing.join(', ')}): install Google Chrome, or run \`npx playwright-core install chromium\` in ${import.meta.dirname}, or set DEMO_CHROME to a Chromium-based browser`,
  );
}
