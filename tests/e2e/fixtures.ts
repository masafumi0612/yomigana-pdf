import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type BrowserContext, test as base } from '@playwright/test';

/** ビルドした拡張の置き場所 */
const EXTENSION_DIR = resolve(import.meta.dirname, '../../.output/chrome-mv3');

/** リポジトリのテスト用 PDF の置き場所 */
export const TEST_PDF_DIR = resolve(import.meta.dirname, '../../test-pdfs/out');

/** 拡張を入れたブラウザで使うもの */
interface ExtensionFixtures {
  /** 拡張を入れた Chromium の画面の集まり */
  context: BrowserContext;
  /** 入れた拡張の ID */
  extensionId: string;
}

/** 拡張を入れた Chromium を、テストごとに新しく立ち上げる */
export const test = base.extend<ExtensionFixtures>({
  context: async ({ playwright }, use) => {
    if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
      throw new Error('拡張がビルドされていない。先に npm run build を動かす');
    }
    // 拡張はヘッドレス専用の版（headless shell）では動かないので、ふつうの Chromium を使う
    const context = await playwright.chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

export { expect } from '@playwright/test';
