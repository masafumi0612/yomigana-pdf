import type { Page } from '@playwright/test';

import { expect, openFromFile, printedUrls, stubPrint, test } from './fixtures';

/** 縦書きの印がなく、向きの自信がないかたまりがある Word の PDF */
const UNMARKED_VERTICAL = 'word/word-vertical.pdf';
/** 文字が画像になっている、スキャンしたような PDF（バーの下に案内が出る。Ctrl+P では印刷の案内が出る） */
const SCANNED = 'scanned-like.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;
/** ルビ付きの PDF ができて印刷を呼ぶまで待つ時間の上限（ミリ秒） */
const PRINT_TIMEOUT_MS = 60_000;

/** Chrome のメニューから印刷したときに出す文 */
const PRINT_NOTICE =
  'ルビ付きで印刷するには、リーダーで Ctrl+P（Mac は ⌘P）を押すか、［印刷・保存］から印刷してください。';
/** 文字が画像の PDF で Ctrl+P を押したときの理由 */
const IMAGE_ONLY = '文字が画像の PDF なので、ルビを付けられません。';

/**
 * 文字が画像の PDF を開き、文字が画像だと分かるまで待つ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openScanned(page: Page, extensionId: string): Promise<void> {
  await openFromFile(page, extensionId, SCANNED);
  await expect(page.getByText('この PDF は文字が画像になっている')).toBeVisible();
}

test('印刷の見た目のとき、バーと案内と紙面が見えず、印刷の案内の文だけが見える', async ({
  page,
  extensionId,
}) => {
  // バーの下に案内が出る PDF で確かめる
  await openScanned(page, extensionId);
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();
  await expect(page.locator('#bar')).toBeVisible();
  await expect(page.locator('#print-notice')).toBeHidden();

  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('#bar')).toBeHidden();
  await expect(page.locator('.notices .notice').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.page[data-page-number="1"]')).toBeHidden();
  await expect(page.locator('#print-notice')).toBeVisible();
  await expect(page.locator('#print-notice')).toHaveText(PRINT_NOTICE);
});

test('ルビ付きで印刷できない PDF で Ctrl+P を押したとき、理由の案内が出て、［閉じる］で閉じて焦点が戻る', async ({
  page,
  extensionId,
}) => {
  await openScanned(page, extensionId);
  await page.locator('#viewer-container').focus();

  await page.keyboard.press('Control+P');

  const dialog = page.getByRole('dialog', { name: '印刷について' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(IMAGE_ONLY);
  await expect(dialog).toContainText('Chrome の標準の表示で開くと、ルビなしで印刷できます。');
  await expect(dialog.getByRole('button', { name: '標準の表示で開く' })).toBeFocused();

  await dialog.getByRole('button', { name: '閉じる' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('#viewer-container')).toBeFocused();
});

test('印刷の案内が出ているとき、Esc で閉じる', async ({ page, extensionId }) => {
  await openScanned(page, extensionId);

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toBeHidden();
});

test('Ctrl+P を続けて押したとき、案内は1つだけ出る', async ({ page, extensionId }) => {
  await openScanned(page, extensionId);

  await page.keyboard.press('Control+P');
  await page.keyboard.press('Control+P');

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
});

test('向きを直すモードのとき Ctrl+P を押すと、案内が出て、Esc で案内だけが閉じる', async ({
  page,
  extensionId,
}) => {
  await openScanned(page, extensionId);
  await page.getByRole('button', { name: '向きを直す' }).click();
  await expect(page.locator('#direction-bar')).toBeVisible();

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#direction-bar')).toBeVisible();
});

test('ページのメニューが開いているとき Ctrl+P を押すと、メニューが閉じて案内が出る', async ({
  page,
  extensionId,
}) => {
  await openScanned(page, extensionId);
  await page.locator('.page[data-page-number="1"]').click({ button: 'right' });
  await expect(page.locator('#page-menu')).toBeVisible();

  await page.keyboard.press('Control+P');

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#page-menu')).toBeHidden();
});

test('印刷の見た目のとき、向きを直す枠と切り替えが見えない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: '向きを直す' }).click();
  await expect(page.locator('.direction-toggle').first()).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('.direction-block').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.direction-toggle').filter({ visible: true })).toHaveCount(0);
});

test('印刷の見た目のとき、右クリックのメニューが見えない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });
  await page.locator('.page[data-page-number="1"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '文字の向きを直す…' })).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('#page-menu')).toBeHidden();
});

test('読みを直す窓が開いているとき Ctrl+P を押すと、窓はそのままで、ルビ付きの PDF を作って印刷を呼ぶ', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(PRINT_TIMEOUT_MS * 2);
  await stubPrint(page);
  await openFromFile(page, extensionId, 'horizontal-print.pdf');
  const ruby = page.locator('.page[data-page-number="1"] .ruby-layer [data-base="筒"]');
  await expect(ruby).toBeAttached({ timeout: RUBY_TIMEOUT_MS });
  const box = await ruby.boundingBox();
  if (box === null) throw new Error('ルビが見えていない');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: '読みを直す…' }).click();
  await expect(page.getByLabel('読み（ひらがな）')).toBeFocused();

  await page.keyboard.press('Control+P');

  await expect
    .poll(() => printedUrls(page), { timeout: PRINT_TIMEOUT_MS })
    .toEqual([expect.stringMatching(/^blob:chrome-extension:\/\//u)]);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.getByLabel('読み（ひらがな）')).toBeVisible();
});
