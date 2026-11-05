import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** ルビが付く、横書きのお知らせ（「弁当、水筒、敷物、雨具」がある） */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 開き直していないかを見る印（リーダーの画面の中の変数名） */
const NOT_RELOADED = '__notReloaded';

/** 読みを直す字と、もとのルビ・直したあとのルビ */
const BASE = '筒';
const ORIGINAL_RUBY = 'とう';
const FIXED_RUBY = 'つつ';
/** 直した読みとして足す言葉と読み */
const ENTRY = ['水筒', 'すいつつ'] as const;

/**
 * ページ 1 の、読みを直す字のルビを引く。
 * @param page 画面
 * @returns ルビ
 */
function fixedRuby(page: Page): Locator {
  return page.locator(`.page[data-page-number="1"] .ruby-layer [data-base="${BASE}"]`);
}

/**
 * 設定の画面と同じく、リーダーの外（service worker）から storage.sync に直した読みを書く。
 * 保存の形は src/settings/user-dictionary.ts の目次と中身（1つ）に合わせる。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param entries 言葉と読みの組
 */
async function saveDictionary(
  context: BrowserContext,
  entries: readonly (readonly [string, string])[],
): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (pairs) => {
    const revision = crypto.randomUUID();
    await chrome.storage.sync.set({
      'userDictionary.0': { revision, entries: pairs },
      userDictionary: { revision, chunkCount: 1 },
    });
  }, entries);
}

/**
 * PDF を開いてルビが出るのを待ち、開き直していないかを見る印を付ける。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param ruby 待つルビ
 */
async function openWithRuby(page: Page, extensionId: string, ruby: string): Promise<void> {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(fixedRuby(page)).toHaveText(ruby, { timeout: FIRST_RUBY_TIMEOUT_MS });
  await page.evaluate((flag) => {
    (globalThis as Record<string, unknown>)[flag] = true;
  }, NOT_RELOADED);
}

/**
 * 印が残っている（開き直していない）か。
 * @param page 画面
 * @returns 開き直していなければ true
 */
async function isNotReloaded(page: Page): Promise<boolean> {
  return page.evaluate(
    (flag) => (globalThis as Record<string, unknown>)[flag] === true,
    NOT_RELOADED,
  );
}

test('直した読みを保存してから開いたとき、その読みでルビが付く', async ({
  page,
  context,
  extensionId,
}) => {
  await saveDictionary(context, [ENTRY]);

  await openWithRuby(page, extensionId, FIXED_RUBY);
});

test('開いている間に直した読みを足したとき、開き直さずにルビが変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);

  await saveDictionary(context, [ENTRY]);

  await expect(fixedRuby(page)).toHaveText(FIXED_RUBY);
  expect(await isNotReloaded(page)).toBe(true);
});

test('開いている間に直した読みを消したとき、開き直さずにルビがもとに戻る', async ({
  page,
  context,
  extensionId,
}) => {
  await saveDictionary(context, [ENTRY]);
  await openWithRuby(page, extensionId, FIXED_RUBY);

  await saveDictionary(context, []);

  await expect(fixedRuby(page)).toHaveText(ORIGINAL_RUBY);
  expect(await isNotReloaded(page)).toBe(true);
});
