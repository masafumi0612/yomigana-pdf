import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type BrowserContext,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
  test as base,
  type Worker,
} from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { SettingKey } from '../../src/settings/model';

/** 親スイッチの設定のキー */
const AUTO_REDIRECT_KEY: SettingKey = 'autoRedirect';

/** service worker の中で動かす関数から使う、拡張の API（型だけ。中身は service worker にある） */
declare const chrome: typeof browser;

/** manifest の、サイトを読む権限の項目名 */
const HOST_KEY = 'host_permissions';
const OPTIONAL_HOST_KEY = 'optional_host_permissions';

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

/**
 * 拡張を入れた Chromium を立ち上げる。
 * 拡張はヘッドレス専用の版（headless shell）では動かないので、ふつうの Chromium を使う。
 * @param playwright Playwright 本体
 * @param extensionDir 入れる拡張のフォルダ
 * @returns 拡張を入れた Chromium の画面の集まり
 */
async function launchWithExtension(
  playwright: PlaywrightWorkerArgs['playwright'],
  extensionDir: string,
): Promise<BrowserContext> {
  if (!existsSync(join(extensionDir, 'manifest.json'))) {
    throw new Error('拡張がビルドされていない。先に npm run build を動かす');
  }
  return playwright.chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
}

/**
 * 拡張の ID を、service worker の URL から取り出す。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @returns 拡張の ID
 */
async function findExtensionId(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

/** 拡張を入れた Chromium を、テストごとに新しく立ち上げる */
export const test = base.extend<ExtensionFixtures>({
  context: async ({ playwright }, use) => {
    const context = await launchWithExtension(playwright, EXTENSION_DIR);
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    await use(await findExtensionId(context));
  },
});

/**
 * 「すべてのサイトを読む権限」を最初から持たせ、自動で移すスイッチをオンにした拡張を入れた Chromium。
 *
 * 後から許可する権限は、テストから許可のボタンを押せない。そこで、ビルドした拡張を写した
 * フォルダの manifest だけを書き換えて、後から許可する権限を最初の権限に移す。
 * 本物の拡張のコードは変えず、スイッチも本物の保存先（storage.sync）に書いて動かす。
 */
export const redirectTest = base.extend<ExtensionFixtures>({
  context: async ({ playwright }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'yomigana-e2e-'));
    await cp(EXTENSION_DIR, dir, { recursive: true });
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      string[] | undefined
    >;
    manifest[HOST_KEY] = [...(manifest[HOST_KEY] ?? []), ...(manifest[OPTIONAL_HOST_KEY] ?? [])];
    manifest[OPTIONAL_HOST_KEY] = [];
    await writeFile(manifestPath, JSON.stringify(manifest));

    const context = await launchWithExtension(playwright, dir);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await setAutoRedirect(worker, true);
    await use(context);
    await context.close();
    await rm(dir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    await use(await findExtensionId(context));
  },
});

/**
 * 親スイッチを書き換え、ルールがそれに合うまで待つ。
 * @param worker 拡張の service worker
 * @param isEnabled オンにするなら true
 */
export async function setAutoRedirect(worker: Worker, isEnabled: boolean): Promise<void> {
  await worker.evaluate(
    async ({ key, value }) => {
      await chrome.storage.sync.set({ [key]: value });
    },
    { key: AUTO_REDIRECT_KEY, value: isEnabled },
  );
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.declarativeNetRequest.getDynamicRules()).length > 0,
      ),
    )
    .toBe(isEnabled);
}

/**
 * リーダーを開き、テスト用 PDF をファイルとして選ぶ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param file test-pdfs/out からの PDF の名前
 */
export async function openFromFile(page: Page, extensionId: string, file: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを開く' }).click();
  await (await chooser).setFiles(join(TEST_PDF_DIR, file));
}

export { expect };
