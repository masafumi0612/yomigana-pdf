import type { Page } from '@playwright/test';

import { expect, openFromFile, test } from './fixtures';

/** 縦書きの物語（2ページ） */
const VERTICAL_STORY = 'vertical-story.pdf';
/** せまい画面として確かめる幅（px） */
const NARROW_WIDTH_PX = 768;
/** 画面の高さ（px） */
const VIEWPORT_HEIGHT_PX = 800;
/** 小数の丸めで起きる、はみ出しとみなさない差（px） */
const TOLERANCE_PX = 1;

/**
 * バーの中で見えているボタンの枠を集める。
 * @param page 画面
 * @returns ボタンの名前と枠
 */
async function visibleBarButtons(
  page: Page,
): Promise<{ name: string; left: number; right: number; bottom: number }[]> {
  return page.locator('#bar .bar-button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        name: button.textContent.trim() || button.id,
        left: box.left,
        right: box.right,
        bottom: box.bottom,
      };
    }),
  );
}

test('せまい幅のとき、バーのボタンがすべて画面の中に収まり、1ページ目に重ならない', async ({
  page,
  extensionId,
}) => {
  await page.setViewportSize({ width: NARROW_WIDTH_PX, height: VIEWPORT_HEIGHT_PX });
  await openFromFile(page, extensionId, VERTICAL_STORY);
  await expect(page.locator('.page[data-page-number="1"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /^ルビ：/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chrome で開く（ルビなし）' })).toBeVisible();

  const buttons = await visibleBarButtons(page);
  expect(buttons.length).toBeGreaterThanOrEqual(5);
  for (const button of buttons) {
    expect(button.left, `${button.name} の左`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
    expect(button.right, `${button.name} の右`).toBeLessThanOrEqual(NARROW_WIDTH_PX + TOLERANCE_PX);
  }

  const bar = await page.locator('#bar').boundingBox();
  const container = await page.locator('#viewer-container').boundingBox();
  expect(bar).not.toBeNull();
  expect(container).not.toBeNull();
  const barBottom = (bar?.y ?? 0) + (bar?.height ?? 0);
  for (const button of buttons) {
    expect(button.bottom, `${button.name} の下`).toBeLessThanOrEqual(barBottom + TOLERANCE_PX);
  }
  // 紙面の入れ物はバーの下から始まり、バーのすぐ下で最初に当たるのは紙面の側
  expect(container?.y ?? 0).toBeGreaterThanOrEqual(barBottom - TOLERANCE_PX);
  const isBelowBarInViewer = await page.evaluate(
    (y) => {
      const element = document.elementFromPoint(window.innerWidth / 2, y);
      return element?.closest('#viewer-container') !== null;
    },
    barBottom + TOLERANCE_PX + 1,
  );
  expect(isBelowBarInViewer).toBe(true);
  // バーの横にはみ出して、横にスクロールできてもいけない
  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalScroll).toBe(false);
});
