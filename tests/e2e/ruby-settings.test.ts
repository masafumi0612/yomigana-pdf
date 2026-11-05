import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { Settings } from '../../src/settings/model';
import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** ルビが付く、横書きのお知らせ */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 開き直していないかを見る印（リーダーの画面の中の変数名） */
const NOT_RELOADED = '__notReloaded';

/** 中学で習う字（どの小学校の段階でもルビが残る）と、そのルビ */
const MIDDLE_SCHOOL_BASE = '筒';
const MIDDLE_SCHOOL_RUBY = 'とう';
/** 1年生で習う字（「11月号」などに出る。小学6年までの段階ではルビが消える） */
const FIRST_GRADE_CHAR = '月';

/** 既定の大きさ（中）と大の割合の比（0.6 / 0.5）より少し小さくした、大きくなったと見なす比 */
const LARGER_RATIO = 1.1;

/**
 * ページ 1 のルビの層を引く。
 * @param page 画面
 * @returns ルビの層
 */
function rubyLayer(page: Page): Locator {
  return page.locator('.page[data-page-number="1"] .ruby-layer');
}

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
 * ページ 1 のルビの親字を、出ている順に挙げる。
 * @param page 画面
 * @returns 親字
 */
async function rubyBases(page: Page): Promise<string[]> {
  return rubyLayer(page)
    .locator('span')
    .evaluateAll((spans) =>
      spans.map((span) => (span instanceof HTMLElement ? (span.dataset.base ?? '') : '')),
    );
}

/**
 * PDF を開いてルビが出るのを待ち、開き直していないかを見る印を付ける。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openWithRuby(page: Page, extensionId: string): Promise<void> {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(rubyLayer(page).locator(`[data-base="${MIDDLE_SCHOOL_BASE}"]`)).toHaveText(
    MIDDLE_SCHOOL_RUBY,
    { timeout: FIRST_RUBY_TIMEOUT_MS },
  );
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

test('段階を保存してから開いたとき、その段階でルビが付く', async ({
  page,
  context,
  extensionId,
}) => {
  await saveSettings(context, { level: 'g6' });

  await openFromFile(page, extensionId, HORIZONTAL_PRINT);

  await expect(rubyLayer(page).locator(`[data-base="${MIDDLE_SCHOOL_BASE}"]`)).toHaveText(
    MIDDLE_SCHOOL_RUBY,
    { timeout: FIRST_RUBY_TIMEOUT_MS },
  );
  expect((await rubyBases(page)).some((base) => base.includes(FIRST_GRADE_CHAR))).toBe(false);
});

test('開いている間に段階を変えたとき、開き直さずにルビが付け直される', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  const before = await rubyBases(page);
  expect(before.some((base) => base.includes(FIRST_GRADE_CHAR))).toBe(true);

  await saveSettings(context, { level: 'g6' });

  await expect
    .poll(async () => (await rubyBases(page)).some((base) => base.includes(FIRST_GRADE_CHAR)))
    .toBe(false);
  const after = await rubyBases(page);
  expect(after.length).toBeLessThan(before.length);
  await expect(rubyLayer(page).locator(`[data-base="${MIDDLE_SCHOOL_BASE}"]`)).toHaveText(
    MIDDLE_SCHOOL_RUBY,
  );
  expect(await isNotReloaded(page)).toBe(true);
});

test('段階を変えて戻したとき、ルビの数がもとに戻る', async ({ page, context, extensionId }) => {
  await openWithRuby(page, extensionId);
  const before = (await rubyBases(page)).length;
  await saveSettings(context, { level: 'joyo' });
  await expect.poll(async () => (await rubyBases(page)).length).toBeLessThan(before);

  await saveSettings(context, { level: 'all' });

  await expect.poll(async () => (await rubyBases(page)).length).toBe(before);
});

test('開いている間にルビの色と帯を変えたとき、開き直さずに見た目が変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  const ruby = rubyLayer(page).locator(`[data-base="${MIDDLE_SCHOOL_BASE}"]`);
  await expect(ruby).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(ruby).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await saveSettings(context, { rubyStyle: { size: 'm', color: 'blue', hasBand: true } });

  // RUBY_COLORS.blue（#1d4ed8）と、帯の白
  await expect(ruby).toHaveCSS('color', 'rgb(29, 78, 216)');
  await expect(ruby).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(rubyLayer(page)).toHaveAttribute('aria-hidden', 'true');
  expect(await isNotReloaded(page)).toBe(true);
});

test('開いている間にルビの大きさを変えたとき、開き直さずにルビが置き直される', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  const ruby = rubyLayer(page).locator(`[data-base="${MIDDLE_SCHOOL_BASE}"]`);
  const before = (await ruby.boundingBox())?.width ?? Number.NaN;

  await saveSettings(context, { rubyStyle: { size: 'l', color: 'ink', hasBand: false } });

  // 箱の幅はルビの大きさで決まり、CSS 変数だけでは変わらないので、置き直したことがわかる
  await expect
    .poll(async () => ((await ruby.boundingBox())?.width ?? 0) > before * LARGER_RATIO)
    .toBe(true);
  await expect(ruby).toHaveText(MIDDLE_SCHOOL_RUBY);
  expect(await isNotReloaded(page)).toBe(true);
});
