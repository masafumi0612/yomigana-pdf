import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, TEST_PDF_DIR } from './fixtures';

/** 縦書きの物語（2ページ）。文字の層に出るはずの言葉 */
const VERTICAL_STORY = { file: 'vertical-story.pdf', pageCount: 2, word: '檸檬' };

/** 横書きのお知らせ（1ページ） */
const HORIZONTAL_PRINT = { file: 'horizontal-print.pdf', pageCount: 1, word: '学年だより' };

let server: Server;
let pdfOrigin: string;

// URL から開くのを確かめるため、テスト用 PDF を返すだけのサーバーを立てる。
// 拡張にはまだサイトを読む権限がないので、CORS で読めるようにしておく
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const name = basename(new URL(request.url ?? '/', 'http://localhost').pathname);
    readFile(join(TEST_PDF_DIR, name)).then(
      (data) => {
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'access-control-allow-origin': '*',
        });
        response.end(data);
      },
      () => {
        response.writeHead(404, { 'access-control-allow-origin': '*' });
        response.end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  pdfOrigin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function openFromFile(page: Page, extensionId: string, file: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを開く' }).click();
  await (await chooser).setFiles(join(TEST_PDF_DIR, file));
}

test('ファイルを選んだとき、ファイル名と全ページ数が出る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, VERTICAL_STORY.file);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(VERTICAL_STORY.file);
  await expect(page.locator('#page-total')).toHaveText(`/ ${String(VERTICAL_STORY.pageCount)}`);
});

test('ファイルを選んだとき、紙面と文字の層が出る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, VERTICAL_STORY.file);

  const firstPage = page.locator('.page[data-page-number="1"]');
  await expect(firstPage.locator('canvas')).toBeVisible();
  await expect(firstPage.locator('.textLayer')).toContainText(VERTICAL_STORY.word);
});

test('URL を渡したとき、その PDF の紙面と文字の層が出る', async ({ page, extensionId }) => {
  const pdfUrl = `${pdfOrigin}/${HORIZONTAL_PRINT.file}`;
  await page.goto(
    `chrome-extension://${extensionId}/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
  );

  await expect(page.locator('#page-total')).toHaveText(`/ ${String(HORIZONTAL_PRINT.pageCount)}`);
  await expect(page.locator('.page[data-page-number="1"] .textLayer')).toContainText(
    HORIZONTAL_PRINT.word,
  );
});

test('開けない URL のとき、Chrome の標準の表示で開くボタンに移る', async ({
  page,
  extensionId,
}) => {
  const pdfUrl = `${pdfOrigin}/missing.pdf`;
  await page.goto(
    `chrome-extension://${extensionId}/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
  );

  await expect(page.getByRole('button', { name: /Chrome の標準の表示で開く/u })).toBeFocused();
});

test('ページ番号を入れて Enter を押したとき、そのページに移る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, VERTICAL_STORY.file);
  const pageInput = page.getByRole('textbox', { name: 'ページ番号' });
  await expect(pageInput).toHaveValue('1');

  await pageInput.fill('2');
  await pageInput.press('Enter');

  await expect(page.locator('.page[data-page-number="2"] .textLayer')).toBeInViewport();
});

test('キーボードで拡大のボタンを押したとき、倍率が上がる', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, VERTICAL_STORY.file);
  const zoomLevel = page.getByRole('status', { name: '倍率' });
  await expect(zoomLevel).toHaveText(/%$/u);
  const before = Number.parseInt((await zoomLevel.textContent()) ?? '', 10);

  await page.getByRole('button', { name: '拡大' }).focus();
  await page.keyboard.press('Space');

  await expect
    .poll(async () => Number.parseInt((await zoomLevel.textContent()) ?? '', 10))
    .toBeGreaterThan(before);
});
