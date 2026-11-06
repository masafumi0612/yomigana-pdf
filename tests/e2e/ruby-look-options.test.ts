import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { Settings } from '../../src/settings/model';
import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** ルビが付く、横書きのお知らせ */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 中学で習う字（既定の段階でルビが付く） */
const MIDDLE_SCHOOL_BASE = '筒';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 目当ての場所に着くまで Tab を押す回数の上限 */
const MAX_TABS = 60;
/** 見本の親字の大きさ（px。設定の画面の CSS の --preview-font-size） */
const PREVIEW_FONT_PX = 22;
/** 大きめのルビの割合（RUBY_SIZE_RATIOS.l） */
const LARGE_RATIO = 0.6;
/** RUBY_COLORS.blue（#1d4ed8） */
const BLUE = 'rgb(29, 78, 216)';
/** 帯の白 */
const WHITE = 'rgb(255, 255, 255)';

/**
 * 設定の画面を開く。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openOptions(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ルビの設定');
}

/**
 * 目当ての場所に移るまで Tab を押す（マウスを使わずに操作するため）。
 * @param page 画面
 * @param target 移りたい場所
 */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let count = 0; count < MAX_TABS; count += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error('Tab で目当ての場所に移れなかった');
}

/**
 * 設定の画面と同じく、画面の外（service worker）から storage.sync に設定を書く。
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
 * 保存してあるルビの見た目を、service worker から読む。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @returns 保存してあるルビの見た目
 */
async function storedRubyStyle(context: BrowserContext): Promise<unknown> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(async () => (await chrome.storage.sync.get(['rubyStyle'])).rubyStyle);
}

/**
 * 横書きの見本の、最初のルビを引く。
 * @param page 設定の画面
 * @returns ルビ（rt）
 */
function previewRuby(page: Page): Locator {
  return page.locator('.preview').first().locator('rt').first();
}

test('保存してある見た目のとき、その選択肢が選ばれて出る', async ({
  page,
  context,
  extensionId,
}) => {
  await saveSettings(context, { rubyStyle: { size: 's', color: 'orange', hasBand: true } });

  await openOptions(page, extensionId);

  await expect(page.getByRole('radio', { name: '小さめ' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'オレンジ' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'ルビの後ろに白い帯を付ける' })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'ルビの後ろに白い帯を付ける' }),
  ).toHaveAccessibleDescription('行の間がせまい PDF で読みやすくなります');
});

test('キーボードだけで大きさ・色・帯を変えたとき、見本のルビが変わる', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await expect(previewRuby(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await tabTo(page, page.getByRole('radio', { name: 'ふつう' }));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');

  await expect(page.getByRole('radio', { name: '大きめ' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '青' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'ルビの後ろに白い帯を付ける' })).toBeChecked();
  await expect(previewRuby(page)).toHaveCSS(
    'font-size',
    `${String(PREVIEW_FONT_PX * LARGE_RATIO)}px`,
  );
  await expect(previewRuby(page)).toHaveCSS('color', BLUE);
  await expect(previewRuby(page)).toHaveCSS('background-color', WHITE);
});

test('設定の画面で色を変えたとき、ほかの見た目は残り、開いているリーダーのルビの色が変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await saveSettings(context, { rubyStyle: { size: 'l', color: 'ink', hasBand: true } });
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  const ruby = page.locator(
    `.page[data-page-number="1"] .ruby-layer [data-base="${MIDDLE_SCHOOL_BASE}"]`,
  );
  await expect(ruby).toHaveCSS('color', 'rgb(0, 0, 0)', { timeout: FIRST_RUBY_TIMEOUT_MS });
  const options = await context.newPage();
  await openOptions(options, extensionId);

  await tabTo(options, options.getByRole('radio', { name: '黒' }));
  await options.keyboard.press('ArrowRight');

  await expect
    .poll(() => storedRubyStyle(context))
    .toEqual({ size: 'l', color: 'blue', hasBand: true });
  await expect(ruby).toHaveCSS('color', BLUE);
  await expect(ruby).toHaveCSS('background-color', WHITE);
});

test('大きさ・色・帯を続けて変えたとき、どれも保存される', async ({
  page,
  context,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await tabTo(page, page.getByRole('radio', { name: 'ふつう' }));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');

  await expect
    .poll(() => storedRubyStyle(context))
    .toEqual({ size: 's', color: 'orange', hasBand: true });
});
