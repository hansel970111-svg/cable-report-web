import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { test as base, expect } from '@playwright/test';

import {
  closePackaged,
  launchPackaged,
  type PackagedDesktop,
} from './launch-packaged';

type DesktopFixtures = {
  desktop: PackagedDesktop;
  desktopEnvironment: Readonly<Record<string, string | undefined>>;
};

export const test = base.extend<DesktopFixtures>({
  desktopEnvironment: [{}, { option: true }],
  desktop: async ({ desktopEnvironment }, use, testInfo) => {
    const platform = testInfo.project.name === 'desktop-win' ? 'win32' : 'darwin';
    const desktop = await launchPackaged(platform, desktopEnvironment);
    try {
      // Playwright names its fixture continuation `use`; it is not a React hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use(desktop);
    } finally {
      await closePackaged(desktop);
    }
  },
});

export { expect };

export async function setSaveDialogResult(
  desktop: PackagedDesktop,
  result: { canceled: boolean; filePath?: string; delayMs?: number },
): Promise<void> {
  await desktop.app.evaluate(async ({ dialog }, nextResult) => {
    const state = globalThis as unknown as { __cableE2eSaveDialogCalls: number };
    state.__cableE2eSaveDialogCalls = 0;
    dialog.showSaveDialog = async () => {
      state.__cableE2eSaveDialogCalls += 1;
      if ((nextResult.delayMs ?? 0) > 0) {
        await new Promise(resolve => setTimeout(resolve, nextResult.delayMs));
      }
      return {
        canceled: nextResult.canceled,
        filePath: nextResult.filePath ?? '',
      };
    };
  }, result);
}

export async function saveDialogCallCount(desktop: PackagedDesktop): Promise<number> {
  return desktop.app.evaluate(async () => {
    const state = globalThis as unknown as { __cableE2eSaveDialogCalls?: number };
    return state.__cableE2eSaveDialogCalls ?? 0;
  });
}

export async function downloadEntries(): Promise<Set<string>> {
  try {
    return new Set(await readdir(path.join(homedir(), 'Downloads')));
  } catch {
    return new Set();
  }
}

export function addedEntries(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...after].filter(name => !before.has(name)).sort();
}
