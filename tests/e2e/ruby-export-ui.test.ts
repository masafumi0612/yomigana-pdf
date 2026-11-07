// バーの「印刷・保存」と Ctrl+P から、進み具合・止める・できたときの窓（印刷・保存・開く）・作れないときの案内までを確かめる。
// ヘッドレスでは印刷の画面が出ないので、印刷は「iframe に作った PDF が読み込まれ、その中の print が呼ばれる」までを確かめる。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

import { buildEncryptedPdf } from './encrypted-pdf';
import { expect, openFromFile, printedUrls, stubPrint, test, TEST_PDF_DIR } from './fixtures';

/** 見本の PDF */
const SAMPLE = 'mixed-layout.pdf';
/** 文字が画像になっている、スキャンしたような PDF */
const SCANNED = 'scanned-like.pdf';
/** 長い PDF を作るときに写す見本（2ページ） */
const LONG_SOURCE = 'vertical-story.pdf';
/** 長い PDF のページの数（作っている途中を確かめるため） */
const LONG_PAGES = 40;
/** PDF を開いてボタンが出るまで待つ時間（ミリ秒） */
const OPEN_TIMEOUT_MS = 15_000;
/** PDF ができるまで待つ時間（ミリ秒） */
const EXPORT_TIMEOUT_MS = 60_000;
/** 1つのテストの時間の上限（ミリ秒） */
const TEST_TIMEOUT_MS = 120_000;
/** 作った PDF の URL */
const BLOB_URL = /^blob:chrome-extension:\/\//u;
/** 小数の丸めで起きる、はみ出しとみなさない差（px） */
const TOLERANCE_PX = 1;

/**
 * 見本の PDF のページを何回も写して、長い PDF を作る（テストの中だけで使う）。
 * @returns 長い PDF
 */
async function buildLongPdf(): Promise<Buffer> {
  const source = await PDFDocument.load(await readFile(join(TEST_PDF_DIR, LONG_SOURCE)));
  const document = await PDFDocument.create();
  while (document.getPageCount() < LONG_PAGES) {
    const pages = await document.copyPages(source, source.getPageIndices());
    for (const page of pages) document.addPage(page);
  }
  return Buffer.from(await document.save());
}

/**
 * リーダーを開き、PDF の中身をファイルとして選ぶ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param name ファイル名
 * @param buffer PDF
 */
async function openBuffer(
  page: Page,
  extensionId: string,
  name: string,
  buffer: Buffer,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを開く' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer });
}

/**
 * バーの「印刷・保存」のボタン。
 * @param page 画面
 * @returns ボタン
 */
function exportButton(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('button', { name: '印刷・保存', exact: true });
}

/**
 * できたときの窓。
 * @param page 画面
 * @returns 窓
 */
function doneDialog(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('dialog', { name: 'ルビ付きの PDF ができました' });
}

/**
 * 見本の PDF を開き、ボタンが出るまで待つ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param file test-pdfs/out からの PDF の名前
 */
async function openSample(page: Page, extensionId: string, file = SAMPLE): Promise<void> {
  await openFromFile(page, extensionId, file);
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible({
    timeout: OPEN_TIMEOUT_MS,
  });
  await expect(exportButton(page)).toBeVisible();
}

test('「印刷・保存」を押したとき、進み具合を出して読み上げにも伝え、できたら窓が開く', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openBuffer(page, extensionId, 'long.pdf', await buildLongPdf());
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });

  await exportButton(page).click();

  const progress = /^ルビ付きの PDF を作っています \d+ \/ 40 ページ$/u;
  await expect(page.locator('#export-text')).toHaveText(progress);
  await expect(page.locator('#export-live')).toHaveText(progress);
  await expect(page.locator('#export-live')).toHaveAttribute('aria-live', 'polite');
  await expect(exportButton(page)).toBeDisabled();
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
  await expect(doneDialog(page)).toContainText('long（ルビ付き）.pdf');
  await expect(doneDialog(page).getByRole('button', { name: '印刷', exact: true })).toBeFocused();
  await expect(page.locator('#export-notice')).toBeHidden();
});

test('できたときの窓で［開く］を押したとき、作った PDF を新しいタブで開く', async ({
  page,
  context,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openSample(page, extensionId);
  await exportButton(page).click();
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });

  const opened = context.waitForEvent('page');
  await doneDialog(page).getByRole('button', { name: '開く' }).click();

  const tab = await opened;
  await expect.poll(() => tab.url()).toMatch(BLOB_URL);
  await expect(doneDialog(page)).toBeVisible();
  await expect(doneDialog(page).getByRole('alert')).toBeHidden();
});

test('できたときの窓で［保存］を押したとき、「元の名前（ルビ付き）.pdf」でダウンロードし、題名も同じ名前になる', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openSample(page, extensionId);
  await exportButton(page).click();
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });

  const downloading = page.waitForEvent('download');
  await doneDialog(page).getByRole('button', { name: '保存' }).click();

  const download = await downloading;
  const saved = await PDFDocument.load(await readFile(await download.path()));
  const source = await PDFDocument.load(await readFile(join(TEST_PDF_DIR, SAMPLE)));
  expect([download.suggestedFilename(), saved.getTitle(), saved.getPageCount()]).toEqual([
    'mixed-layout（ルビ付き）.pdf',
    'mixed-layout（ルビ付き）',
    source.getPageCount(),
  ]);
});

test('暗号化した PDF のとき、ルビを書き込めないことを案内し、窓は出さない', async ({
  page,
  extensionId,
}) => {
  // 権限のパスワードだけの PDF は、パスワードを聞かずにリーダーで開ける
  await openBuffer(page, extensionId, 'locked.pdf', buildEncryptedPdf(''));
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });

  await exportButton(page).click();

  const message =
    'パスワードや編集の制限がある PDF には、ルビを書き込めません。リーダーで見ることはできます。';
  await expect(page.locator('#export-text')).toHaveText(message);
  await expect(page.locator('#export-live')).toHaveText(message);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#export-notice').getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('#export-notice')).toBeHidden();
  await expect(exportButton(page)).toBeFocused();
});

test('文字が画像の PDF のとき、押すとルビを付けられない理由を案内する', async ({
  page,
  extensionId,
}) => {
  await openSample(page, extensionId, SCANNED);
  await expect(page.getByText('この PDF は文字が画像になっている')).toBeVisible();

  await exportButton(page).click();

  await expect(page.locator('#export-text')).toHaveText(
    '文字が画像の PDF なので、ルビを付けられません。',
  );
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('作っている途中で［止める］を押したとき、何も出さずに元に戻る', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openBuffer(page, extensionId, 'long.pdf', await buildLongPdf());
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  await exportButton(page).click();
  await expect(page.locator('#export-text')).toHaveText(/ルビ付きの PDF を作っています/u);

  await page.locator('#export-notice').getByRole('button', { name: '止める' }).click();

  await expect(page.locator('#export-notice')).toBeHidden();
  await expect(exportButton(page)).toBeEnabled();
  await expect(exportButton(page)).toBeFocused();
  // 止めたあとに途中の結果で窓が出ないこと
  await page.waitForTimeout(2000);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('作っている途中で向きを変えたとき、初めから作り直す', async ({ page, extensionId }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openBuffer(page, extensionId, 'long.pdf', await buildLongPdf());
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  await exportButton(page).click();
  await expect(page.locator('#export-text')).toHaveText(/ルビ付きの PDF を作っています/u);

  await page.getByRole('button', { name: '向きを直す' }).click();
  await page.getByRole('button', { name: 'すべて縦書き' }).click();

  await expect(page.locator('#export-text')).toHaveText(
    /^変更に合わせて作り直しています \d+ \/ 40 ページ$/u,
  );
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
});

test('キーボードだけで、作る・窓のボタンを移る・Esc で閉じて焦点が戻る', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openSample(page, extensionId);
  await exportButton(page).focus();

  await page.keyboard.press('Enter');
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
  await expect(doneDialog(page).getByRole('button', { name: '印刷', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(doneDialog(page).getByRole('button', { name: '保存' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(doneDialog(page).getByRole('button', { name: '開く' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(doneDialog(page).getByRole('button', { name: '閉じる' })).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(doneDialog(page)).toBeHidden();
  await expect(exportButton(page)).toBeFocused();
});

test('できたときの窓で［印刷］を押したとき、作った PDF を見えない iframe に読み込んで印刷を呼ぶ', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await stubPrint(page);
  await openSample(page, extensionId);
  await exportButton(page).click();
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });

  await doneDialog(page).getByRole('button', { name: '印刷', exact: true }).click();

  await expect.poll(() => printedUrls(page)).toEqual([expect.stringMatching(BLOB_URL)]);
  const frame = page.locator('iframe.print-frame');
  await expect(frame).toHaveAttribute('src', (await printedUrls(page))[0] ?? '');
  await expect(frame).toHaveAttribute('aria-hidden', 'true');
  await expect(doneDialog(page).getByRole('alert')).toBeHidden();
});

test('印刷を呼べなかったとき、窓で［開く］から新しいタブで印刷するよう案内する', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await stubPrint(page, true);
  await openSample(page, extensionId);
  await exportButton(page).click();
  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });

  await doneDialog(page).getByRole('button', { name: '印刷', exact: true }).click();

  await expect(doneDialog(page).getByRole('alert')).toHaveText(
    '印刷の画面を出せませんでした。［開く］で新しいタブに開いてから印刷してください。',
  );
  await expect(doneDialog(page).getByRole('button', { name: '開く' })).toBeFocused();
  await expect(page.locator('iframe.print-frame')).toHaveCount(0);
});

test('Ctrl+P を押したとき、進み具合を出してルビ付きの PDF を作り、窓を出さずに印刷を呼ぶ', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await stubPrint(page);
  await openBuffer(page, extensionId, 'long.pdf', await buildLongPdf());
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });

  await page.keyboard.press('Control+P');

  await expect(page.locator('#export-text')).toHaveText(/^ルビ付きの PDF を作っています/u);
  await expect(
    page.locator('#export-notice').getByRole('button', { name: '止める' }),
  ).toBeVisible();
  await expect
    .poll(() => printedUrls(page), { timeout: EXPORT_TIMEOUT_MS })
    .toEqual([expect.stringMatching(BLOB_URL)]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#export-notice')).toBeHidden();
});

test('Ctrl+P で印刷を呼べなかったとき、できたときの窓を出して［開く］へ案内する', async ({
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await stubPrint(page, true);
  await openSample(page, extensionId);

  await page.keyboard.press('Control+P');

  await expect(doneDialog(page)).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
  await expect(doneDialog(page).getByRole('alert')).toContainText('印刷の画面を出せませんでした');
  await expect(doneDialog(page).getByRole('button', { name: '開く' })).toBeFocused();
});

test('暗号化した PDF で Ctrl+P を押したとき、印刷の案内の窓に理由と［標準の表示で開く］を出す', async ({
  page,
  extensionId,
}) => {
  await stubPrint(page);
  await openBuffer(page, extensionId, 'locked.pdf', buildEncryptedPdf(''));
  await expect(exportButton(page)).toBeVisible({ timeout: OPEN_TIMEOUT_MS });

  await page.keyboard.press('Control+P');

  const notice = page.getByRole('dialog', { name: '印刷について' });
  await expect(notice).toContainText(
    'パスワードや編集の制限がある PDF には、ルビを書き込めません。リーダーで見ることはできます。',
  );
  await expect(notice.getByRole('button', { name: '標準の表示で開く' })).toBeFocused();
  await expect(page.locator('#export-notice')).toBeHidden();
  expect(await printedUrls(page)).toEqual([]);
});

for (const width of [400, 1280]) {
  test(`幅 ${String(width)}px のとき、「印刷・保存」を含むバーのボタンが画面に収まり、折り返さない`, async ({
    page,
    extensionId,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openSample(page, extensionId);

    const buttons = await page.locator('#bar .bar-button:visible').evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.textContent.trim() || element.id,
          left: box.left,
          right: box.right,
          // 文字が折り返すと、行の数だけ箱ができる。はみ出すと、中の幅がボタンより広くなる
          lines: element.querySelector('span')?.getClientRects().length ?? 1,
          isOverflowing: element.scrollWidth > element.clientWidth + 1,
        };
      }),
    );
    const exportBox = buttons.find((button) => button.name === '印刷・保存');
    expect(exportBox, '「印刷・保存」のボタン').toBeDefined();
    for (const button of buttons) {
      expect(button.left, `${button.name} の左`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
      expect(button.right, `${button.name} の右`).toBeLessThanOrEqual(width + TOLERANCE_PX);
    }
    expect({ lines: exportBox?.lines, isOverflowing: exportBox?.isOverflowing }).toEqual({
      lines: 1,
      isOverflowing: false,
    });
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
}
