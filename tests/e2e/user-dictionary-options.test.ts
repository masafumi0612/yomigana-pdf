import type { Locator, Page } from '@playwright/test';

import { expect, openFromFile, test } from './fixtures';

/** ルビが付く、横書きのお知らせ（「弁当、水筒、敷物、雨具」がある） */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 開き直していないかを見る印（リーダーの画面の中の変数名） */
const NOT_RELOADED = '__notReloaded';
/** 目当ての場所に着くまで Tab を押す回数の上限 */
const MAX_TABS = 40;

/** 読みを直す字と、もとのルビ・直したあとのルビ */
const BASE = '筒';
const ORIGINAL_RUBY = 'とう';
const FIXED_RUBY = 'つつ';
/** 足す言葉と読み */
const SURFACE = '水筒';
const READING = 'すいつつ';

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
 * 「直した読み」の一覧を引く。
 * @param page 設定の画面
 * @returns 一覧
 */
function dictionaryList(page: Page): Locator {
  return page.getByRole('list', { name: '直した読み' });
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
 * 設定の画面で、キーボードだけで言葉と読みを足す。
 * @param page 設定の画面
 * @param surface 言葉
 * @param reading 読み
 */
async function addByKeyboard(page: Page, surface: string, reading: string): Promise<void> {
  await tabTo(page, page.getByLabel('言葉', { exact: true }));
  await page.keyboard.insertText(surface);
  await page.keyboard.press('Tab');
  await page.keyboard.insertText(reading);
  await page.keyboard.press('Enter');
  await expect(dictionaryList(page).getByRole('listitem').filter({ hasText: surface })).toHaveCount(
    1,
  );
}

/**
 * ページ 1 の、読みを直す字のルビを引く。
 * @param page リーダーの画面
 * @returns ルビ
 */
function fixedRuby(page: Page): Locator {
  return page.locator(`.page[data-page-number="1"] .ruby-layer [data-base="${BASE}"]`);
}

/**
 * PDF を開いてルビが出るのを待ち、開き直していないかを見る印を付ける。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openPdf(page: Page, extensionId: string): Promise<void> {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(fixedRuby(page)).toHaveText(ORIGINAL_RUBY, { timeout: FIRST_RUBY_TIMEOUT_MS });
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

test('まだ何も足していないとき、「まだありません」と出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);

  await expect(dictionaryList(page)).toHaveText('まだありません');
});

test('設定の画面で言葉と読みを足したとき、ほかのタブの PDF のルビが開き直さずに変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await openPdf(page, extensionId);
  const options = await context.newPage();
  await openOptions(options, extensionId);

  await addByKeyboard(options, SURFACE, READING);

  await expect(fixedRuby(page)).toHaveText(FIXED_RUBY);
  expect(await isNotReloaded(page)).toBe(true);
});

test('設定の画面で元に戻したとき、ほかのタブの PDF のルビが開き直さずにもとに戻る', async ({
  page,
  context,
  extensionId,
}) => {
  await openPdf(page, extensionId);
  const options = await context.newPage();
  await openOptions(options, extensionId);
  await addByKeyboard(options, SURFACE, READING);
  await expect(fixedRuby(page)).toHaveText(FIXED_RUBY);

  await options.getByRole('button', { name: `「${SURFACE}」の読みを元に戻す` }).click();

  await expect(dictionaryList(options)).toHaveText('まだありません');
  await expect(fixedRuby(page)).toHaveText(ORIGINAL_RUBY);
  expect(await isNotReloaded(page)).toBe(true);
});

test('キーボードだけで読みを変えたとき、一覧の読みが変わり、「読みを変える」に戻る', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await addByKeyboard(page, SURFACE, READING);
  const change = page.getByRole('button', { name: `「${SURFACE}」の読みを変える` });

  await tabTo(page, change);
  await page.keyboard.press('Enter');
  const field = page.getByLabel(`「${SURFACE}」の読み`, { exact: true });
  await expect(field).toBeFocused();
  await field.fill('すいとう');
  await page.keyboard.press('Enter');

  await expect(dictionaryList(page).getByRole('listitem')).toContainText('すいとう');
  await expect(change).toBeFocused();
});

test('読みを変える欄で Escape を押したとき、変えずに閉じる', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  await addByKeyboard(page, SURFACE, READING);
  const change = page.getByRole('button', { name: `「${SURFACE}」の読みを変える` });
  await change.click();
  await page.keyboard.insertText('ちがう');

  await page.keyboard.press('Escape');

  await expect(change).toBeFocused();
  await expect(dictionaryList(page).getByRole('listitem')).toContainText(READING);
});

test('読みが片仮名のとき、足さずに欄の下に理由が出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const reading = page.getByLabel('読み', { exact: true });
  await page.getByLabel('言葉', { exact: true }).fill(SURFACE);
  await reading.fill('スイトウ');

  await page.getByRole('button', { name: '足す', exact: true }).click();

  await expect(reading).toHaveAttribute('aria-invalid', 'true');
  await expect(reading).toHaveAccessibleDescription('読みはひらがなで入れてください。');
  await expect(dictionaryList(page)).toHaveText('まだありません');
});

test('言葉に漢字がないとき、足さずに欄の下に理由が出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const surface = page.getByLabel('言葉', { exact: true });
  await surface.fill('すいとう');
  await page.getByLabel('読み', { exact: true }).fill('すいとう');

  await page.getByRole('button', { name: '足す', exact: true }).click();

  await expect(surface).toHaveAttribute('aria-invalid', 'true');
  await expect(surface).toHaveAccessibleDescription(/漢字を含む言葉を入れてください/u);
});

test('設定を最初の状態にもどしたとき、直した読みは残る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  await addByKeyboard(page, SURFACE, READING);

  await page.getByRole('button', { name: '設定を最初の状態にもどす' }).click();
  await page.getByRole('button', { name: 'もどす', exact: true }).click();
  await expect(page.getByText('設定を最初の状態にもどしました。')).toBeVisible();
  await page.reload();

  await expect(dictionaryList(page).getByRole('listitem')).toContainText(SURFACE);
});
