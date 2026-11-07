import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { Settings } from '../../src/settings/model';
import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** 縦書きの印がなく、向きの自信がないかたまりがある Word の PDF */
const UNMARKED_VERTICAL = 'word/word-vertical.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;
/** 開き直していないかを見る印（リーダーの画面の中の変数名） */
const NOT_RELOADED = '__notReloaded';

/**
 * 設定の画面と同じく、リーダーの外（service worker）から storage.sync に設定を書く。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param values 書く設定
 */
async function saveSettings(context: BrowserContext, values: Partial<Settings>): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (items) => {
    await chrome.storage.sync.set(items);
  }, values);
}

/**
 * バーの、今のルビの量のボタンを引く。
 * @param page リーダーの画面
 * @returns ボタン
 */
function amountButton(page: Page): Locator {
  return page.getByRole('button', { name: /^ルビ：/ });
}

/**
 * リーダーを PDF なしで開く。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openReader(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  await expect(page.getByRole('button', { name: 'ファイルを開く' })).toBeVisible();
}

test('段階を保存してからリーダーを開いたとき、バーにその段階が出る', async ({
  page,
  context,
  extensionId,
}) => {
  await saveSettings(context, { level: 'g3' });

  await openReader(page, extensionId);

  await expect(amountButton(page)).toHaveText('ルビ：3年までの漢字には付けない');
  await expect(amountButton(page)).toHaveAccessibleName(
    'ルビ：3年までの漢字には付けない（ルビの設定を開く）',
  );
  await expect(amountButton(page)).toHaveAttribute('title', 'ルビの設定を開く');
});

test('何も保存していないとき、バーに「すべての漢字に付ける」が出る', async ({
  page,
  extensionId,
}) => {
  await openReader(page, extensionId);

  await expect(amountButton(page)).toHaveText('ルビ：すべての漢字に付ける');
});

test('開いている間に段階を変えたとき、バーの文字が開き直さずに変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await openReader(page, extensionId);
  await page.evaluate((flag) => {
    (globalThis as Record<string, unknown>)[flag] = true;
  }, NOT_RELOADED);

  await saveSettings(context, { level: 'joyo' });

  await expect(amountButton(page)).toHaveText('ルビ：常用漢字には付けない');
  await saveSettings(context, { level: 'm2' });
  await expect(amountButton(page)).toHaveText('ルビ：中2までの漢字には付けない');
  expect(
    await page.evaluate((flag) => (globalThis as Record<string, unknown>)[flag], NOT_RELOADED),
  ).toBe(true);
});

test('バーのボタンを押したとき、設定の画面がタブで開く', async ({ page, context, extensionId }) => {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  // 初めて入れたときに開いた設定の画面を閉じ、ボタンで新しく開くのを確かめる
  for (const opened of context.pages().filter((other) => other.url() === optionsUrl)) {
    await opened.close();
  }
  await openReader(page, extensionId);

  const opening = context.waitForEvent('page');
  await amountButton(page).click();

  const options = await opening;
  await expect(options).toHaveURL(optionsUrl);
  await expect(options.getByRole('heading', { level: 1 })).toHaveText('ルビの設定');
});

test('向きを直すモードの間、バーのルビの量のボタンは隠れ、終えると戻る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });

  await page.getByRole('button', { name: '向きを直す' }).click();

  await expect(page.locator('.bar--editing')).toBeVisible();
  await expect(amountButton(page)).toBeHidden();
  await page.getByRole('button', { name: '終わる' }).click();
  await expect(amountButton(page)).toBeVisible();
});
