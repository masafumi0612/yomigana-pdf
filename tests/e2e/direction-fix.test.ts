import type { Page } from '@playwright/test';

import { expect, openFromFile, test } from './fixtures';

/** 縦書きの印がなく、向きを推定する Word の PDF */
const UNMARKED_VERTICAL = 'word/word-vertical.pdf';
/** 縦書きと横書きが混じったプリント */
const MIXED = 'mixed-direction.pdf';
/** 1字だけで向きの手がかりのないかたまりがある紙面 */
const MIXED_LAYOUT = 'mixed-layout.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;

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
 * 向きを直すモードに入る。
 * @param page 画面
 */
async function enterMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: '直す' }).click();
  await expect(page.locator('.direction-toggle').first()).toBeVisible();
}

test('縦書きの印がない PDF のとき、向きを直せる案内がバーの下に出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await expect(page.getByText('文字の向きが違うところがあれば直せます')).toBeVisible();
});

test('1字だけで向きの分からないかたまりがある紙面のとき、向きを直せる案内が出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, MIXED_LAYOUT);
  await waitForRuby(page);

  await expect(page.getByRole('button', { name: '直す' })).toBeVisible();
});

test('向きがすべて確かな PDF のとき、向きを直せる案内は出ない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, MIXED);
  await waitForRuby(page);

  await expect(page.getByRole('button', { name: '直す' })).toBeHidden();
});

test('直すモードに入ったとき、バーが青になり、かたまりごとの切り替えが出る', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);

  await enterMode(page);

  await expect(page.locator('.bar--editing')).toBeVisible();
  await expect(page.getByText('向きが違うところは、正しいほうを押してください')).toBeVisible();
  await expect(page.locator('.direction-toggle')).toHaveCount(4);
  // 向きに自信がないかたまりの枠は、色を変えて目立たせる
  await expect(page.locator('.direction-block[data-uncertain="true"]')).toHaveCount(4);
  // 案内は、モードの間は出さない
  await expect(page.getByRole('button', { name: '直す', exact: true })).toBeHidden();
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

test('キーボードのとき、Tab でかたまりを移り、Space で向きを変えられる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await waitForRuby(page);
  const before = await verticalRubies(page);
  await enterMode(page);
  const toggles = page.locator('.direction-toggle');
  await expect(toggles.first()).toBeFocused();

  await page.keyboard.press('Space');

  await expect.poll(() => verticalRubies(page)).toBeLessThan(before);
  // 向きを変えても、移った先の切り替えに留まる
  await expect(toggles.first()).toBeFocused();
  await expect(toggles.first()).toHaveAttribute('aria-label', /横書きです。押すと縦書きに/);
  await page.keyboard.press('Tab');
  await expect(toggles.nth(1)).toBeFocused();
});
