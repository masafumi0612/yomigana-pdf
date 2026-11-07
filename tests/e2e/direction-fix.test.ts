import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { Settings } from '../../src/settings/model';
import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** 縦書きの印がなく、向きを推定する Word の PDF */
const UNMARKED_VERTICAL = 'word/word-vertical.pdf';
/** 縦書きと横書きが混じったプリント */
const MIXED = 'mixed-direction.pdf';
/** 1字だけで向きの手がかりのないかたまりがある紙面 */
const MIXED_LAYOUT = 'mixed-layout.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;
/** 押せる所の大きさの下限（px）。WCAG 2.2 AA の「ターゲットのサイズ（最低限）」 */
const MIN_TARGET_PX = 24;
/** 狭い窓の幅（px） */
const NARROW_WIDTH_PX = 400;
/** 広い窓の幅（px） */
const WIDE_WIDTH_PX = 1280;
/** 窓の高さ（px） */
const VIEWPORT_HEIGHT_PX = 800;
/** 小数の丸めで起きる、ずれとみなさない差（px） */
const TOLERANCE_PX = 1;

/**
 * ページ 1 の縦書きのルビの数を数える。
 * @param page 画面
 * @returns 縦書きのルビの数
 */
function verticalRubies(page: Page): ReturnType<ReturnType<Page['locator']>['count']> {
  return page.locator('.page[data-page-number="1"] .ruby-layer > .ruby-vertical').count();
}

/**
 * ルビが出るまで待つ。
 * @param page 画面
 */
async function waitForRuby(page: Page): Promise<void> {
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });
}

/**
 * バーの、向きを直すモードに入るボタンを引く。
 * @param page 画面
 * @returns 向きを直すボタン
 */
function directionButton(page: Page): Locator {
  return page.getByRole('button', { name: '向きを直す' });
}

/**
 * 向きを直すモードに入る。
 * @param page 画面
 */
async function enterMode(page: Page): Promise<void> {
  await directionButton(page).click();
  await expect(page.locator('.direction-toggle').first()).toBeVisible();
}

/**
 * ページ 1 のかたまりの枠を引く。
 * @param page 画面
 * @returns かたまりの枠
 */
function frames(page: Page): Locator {
  return page.locator('.page[data-page-number="1"] .direction-block');
}

/**
 * 見えている向きの切り替えを引く。
 * @param page 画面
 * @returns 見えている切り替え
 */
function visibleToggles(page: Page): Locator {
  return page.locator('.direction-toggle').filter({ visible: true });
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

for (const file of [UNMARKED_VERTICAL, MIXED_LAYOUT, MIXED]) {
  test(`向きの自信がないかたまりがあってもなくても、向きを直すボタンはいつも同じ見た目で出る（${file}）`, async ({
    page,
    extensionId,
  }) => {
    await openFromFile(page, extensionId, file);
    await waitForRuby(page);

    await expect(directionButton(page)).toBeVisible();
    // 絵と文字のほかに、点などの印を付けない
    await expect(
      directionButton(page).locator(':scope > :not(svg, #direction-entry-label)'),
    ).toHaveCount(0);
  });
}

test('向きを直すボタンの名前は文字だけで、何をするかの説明がある', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await expect(directionButton(page)).toHaveAccessibleName('向きを直す');
  await expect(directionButton(page)).toHaveAttribute('title', /文字の向き/);
});

test('向きを直すボタンは、バーでページ番号のすぐ隣にある', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, MIXED);
  await waitForRuby(page);

  const next = page.locator('#page-total + *');

  await expect(next).toHaveId('direction-entry');
});

test('向きを直すボタンは 24px 四方以上の大きさがある', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, MIXED);
  await waitForRuby(page);

  const box = await directionButton(page).boundingBox();

  expect(box?.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(box?.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
});

test('向きを直すボタンを押したとき、直すモードに入り、ボタンは隠れる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, MIXED);
  await waitForRuby(page);

  await directionButton(page).click();

  await expect(page.locator('.bar--editing')).toBeVisible();
  await expect(page.locator('.direction-toggle').first()).toBeVisible();
  await expect(directionButton(page)).toBeHidden();
});

test('キーボードのとき、ページ番号の欄から Tab で向きを直すボタンに移り、移ったことが枠線で見える', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await page.getByRole('textbox', { name: 'ページ番号' }).focus();

  await page.keyboard.press('Tab');

  await expect(directionButton(page)).toBeFocused();
  await expect(directionButton(page)).toHaveCSS('outline-style', 'solid');
});

test('キーボードのとき、向きを直すボタンで Enter を押すと、直すモードに入る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await directionButton(page).focus();

  await page.keyboard.press('Enter');

  await expect(page.locator('.bar--editing')).toBeVisible();
  // モードに入ると、最初のかたまりの枠に移る
  await expect(frames(page).first()).toBeFocused();
});

test('終わるを押したとき、向きを直すボタンがまた出る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);

  await page.getByRole('button', { name: '終わる' }).click();

  await expect(directionButton(page)).toBeVisible();
});

test('向きの自信がないかたまりがあるとき、バーの下に向きを直せる案内は出さない', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await expect(directionButton(page)).toBeVisible();
  await expect(page.locator('.notice').filter({ visible: true })).toHaveCount(0);
});

for (const width of [NARROW_WIDTH_PX, WIDE_WIDTH_PX]) {
  test(`幅が ${String(width)}px の窓のとき、向きを直すボタンがバーの中で画面に収まる`, async ({
    page,
    extensionId,
  }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT_PX });
    await openFromFile(page, extensionId, UNMARKED_VERTICAL);
    await waitForRuby(page);

    const bar = await page.locator('#bar').boundingBox();
    const box = await directionButton(page).boundingBox();

    expect(box?.x).toBeGreaterThanOrEqual(-TOLERANCE_PX);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + TOLERANCE_PX);
    expect(box?.y).toBeGreaterThanOrEqual((bar?.y ?? 0) - TOLERANCE_PX);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      (bar?.y ?? 0) + (bar?.height ?? 0) + TOLERANCE_PX,
    );
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
}

test('直すモードに入ったとき、バーが青になり、すべてのかたまりに枠が出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await enterMode(page);

  await expect(page.locator('.bar--editing')).toBeVisible();
  await expect(page.getByText('向きが違うところは、正しいほうを押してください')).toBeVisible();
  await expect(frames(page)).toHaveCount(4);
  // 向きに自信がないかたまりの枠は、色を変えて目立たせる
  await expect(page.locator('.direction-block[data-uncertain="true"]')).toHaveCount(4);
  // モードに入るボタンは、モードの間は出さない
  await expect(directionButton(page)).toBeHidden();
});

test('直すモードに入ったとき、切り替えは最初のかたまりにだけ出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await enterMode(page);

  await expect(visibleToggles(page)).toHaveCount(1);
  await expect(frames(page).first().locator('.direction-toggle')).toBeVisible();
});

test('かたまりの枠を押したとき、そのかたまりにだけ切り替えが出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);

  await frames(page).nth(2).click();

  await expect(frames(page).nth(2).locator('.direction-toggle')).toBeVisible();
  await expect(visibleToggles(page)).toHaveCount(1);
});

test('かたまりの切り替えを押したとき、そのかたまりだけ横書きになり、ルビが字の上に付き直る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  const before = await verticalRubies(page);
  await enterMode(page);

  await page.locator('.direction-toggle').first().getByText('横書き').click();

  await expect.poll(() => verticalRubies(page)).toBeLessThan(before);
  expect(await verticalRubies(page)).toBeGreaterThan(0);
  // 向きが決まったかたまりは、自信のない色の枠ではなくなる
  await expect(page.locator('.direction-block[data-uncertain="true"]')).toHaveCount(3);
});

test('切り替えのもう一方を押したとき、もとの向きに戻り、ルビも戻る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  const before = await verticalRubies(page);
  await enterMode(page);
  const toggle = page.locator('.direction-toggle').first();
  await toggle.getByText('横書き').click();
  await expect.poll(() => verticalRubies(page)).toBeLessThan(before);

  await toggle.getByText('縦書き').click();

  await expect.poll(() => verticalRubies(page)).toBe(before);
});

test('すべて横書きを押したとき、縦書きのルビがなくなる', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);

  await page.getByRole('button', { name: 'すべて横書き' }).click();

  await expect.poll(() => verticalRubies(page)).toBe(0);
});

test('すべて縦書きを押したとき、横書きのかたまりも縦書きのルビになる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, MIXED_LAYOUT);
  await waitForRuby(page);
  const before = await page.locator('.ruby-layer > span:not(.ruby-vertical)').count();
  expect(before).toBeGreaterThan(0);
  await enterMode(page);

  await page.getByRole('button', { name: 'すべて縦書き' }).click();

  await expect.poll(() => page.locator('.ruby-layer > span:not(.ruby-vertical)').count()).toBe(0);
});

test('終わるを押したとき、バーがもとに戻り、切り替えがなくなり、ルビは直したままになる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);
  await page.getByRole('button', { name: 'すべて横書き' }).click();
  await expect.poll(() => verticalRubies(page)).toBe(0);

  await page.getByRole('button', { name: '終わる' }).click();

  await expect(page.locator('.bar--editing')).toHaveCount(0);
  await expect(page.locator('.direction-toggle')).toHaveCount(0);
  expect(await verticalRubies(page)).toBe(0);
});

test('紙面を右クリックしたとき、メニューから向きを直すモードに入れる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, MIXED);
  await waitForRuby(page);

  await page.locator('.page[data-page-number="1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '文字の向きを直す…' }).click();

  await expect(page.locator('.bar--editing')).toBeVisible();
  await expect(page.locator('.direction-toggle').first()).toBeVisible();
});

test('キーボードのとき、Tab で切り替えに移り、Space で向きを変えられる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  const before = await verticalRubies(page);
  await enterMode(page);
  // モードに入ると、最初のかたまりの枠に移る
  await expect(frames(page).first()).toBeFocused();
  await page.keyboard.press('Tab');
  const toggle = frames(page).first().locator('.direction-toggle');
  await expect(toggle).toBeFocused();

  await page.keyboard.press('Space');

  await expect.poll(() => verticalRubies(page)).toBeLessThan(before);
  // 向きを変えても、移った先の切り替えに留まる
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-label', /横書きです。押すと縦書きに/);
});

test('キーボードで次のかたまりに移ったとき、そのかたまりにだけ切り替えが出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);
  await page.keyboard.press('Tab');

  await page.keyboard.press('Tab');

  await expect(frames(page).nth(1)).toBeFocused();
  await expect(frames(page).nth(1).locator('.direction-toggle')).toBeVisible();
  await expect(visibleToggles(page)).toHaveCount(1);
});

// 向きの読み直しの返事を待つ間に段階が変わるときは、単体テスト（ruby-pages.test.ts）で確かめる
test('かたまりの向きを変えたあとに段階を変えたとき、変えた向きのまま読み直される', async ({
  page,
  context,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  await enterMode(page);
  // 最初のかたまりは「今日は朝から雨だった。…」。雨は 1 年生で習うので、1 年生の段階でルビが消える
  const rubyLayer = page.locator('.page[data-page-number="1"] .ruby-layer');
  await expect(rubyLayer.locator('[data-base="雨"]')).toHaveCount(1);
  await frames(page).first().locator('.direction-toggle').getByText('横書き').click();
  await expect(rubyLayer.locator('[data-base="朝"]')).not.toHaveClass(/ruby-vertical/);

  await saveSettings(context, { level: 'g1' });

  await expect(rubyLayer.locator('[data-base="雨"]')).toHaveCount(0);
  await expect(frames(page).first()).toHaveAttribute('aria-label', /^横書き/);
  await expect(rubyLayer.locator('[data-base="朝"]')).not.toHaveClass(/ruby-vertical/);
});

test('モードの間に紙面を回したとき、枠が回した紙面に付いてきて、向きを変えられる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  const before = await verticalRubies(page);
  await enterMode(page);
  const frame = frames(page).first();
  const upright = await frame.boundingBox();
  // 縦書きの列の枠は縦に長い
  expect(upright?.height).toBeGreaterThan(upright?.width ?? Number.POSITIVE_INFINITY);

  await page.getByRole('button', { name: '右に回す' }).click();

  // 右に回すと、列の枠は横に長くなる
  await expect
    .poll(async () => {
      const box = await frame.boundingBox();
      return (box?.width ?? 0) > (box?.height ?? 0);
    })
    .toBe(true);
  await expect(page.locator('.bar--editing')).toBeVisible();
  await frame.locator('.direction-toggle').getByText('横書き').click();
  await expect.poll(() => verticalRubies(page)).toBeLessThan(before);
});

for (const file of [UNMARKED_VERTICAL, MIXED, MIXED_LAYOUT]) {
  test(`幅が狭い窓のとき、どのかたまりの切り替えも紙面の中に収まる（${file}）`, async ({
    page,
    extensionId,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH_PX, height: 800 });
    await openFromFile(page, extensionId, file);
    await waitForRuby(page);
    await page.locator('.page[data-page-number="1"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '文字の向きを直す…' }).click();
    await expect(visibleToggles(page)).toHaveCount(1);
    const paper = await page.locator('.page[data-page-number="1"]').boundingBox();
    const count = await frames(page).count();

    for (let index = 0; index < count; index++) {
      await frames(page).nth(index).focus();
      const box = await visibleToggles(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual((paper?.x ?? 0) - 1);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (paper?.x ?? 0) + (paper?.width ?? 0) + 1,
      );
    }
  });
}
