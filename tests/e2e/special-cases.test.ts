import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, join } from 'node:path';

import type { browser } from 'wxt/browser';

import { buildEncryptedPdf } from './encrypted-pdf';
import { expect, openFromFile, test, TEST_PDF_DIR } from './fixtures';

/** 画面の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** 画像だけの PDF（文字がない） */
const SCANNED = 'scanned-like.pdf';
/** ルビが付く、横書きのお知らせ */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;
/** テスト用 PDF のパスワード（テストの中で作る PDF にだけ使う） */
const PASSWORD = 'open-sesame';

/** 読みの問い合わせを失敗させる印（リーダーの画面の中の変数名） */
const FAIL_READINGS = '__failReadings';

let server: Server;
let pdfOrigin: string;

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

test('画像だけの PDF のとき、ルビを付けられない案内が出て、閉じられる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, SCANNED);

  const notice = page.getByRole('status').filter({ hasText: '文字が画像になっている' });
  await expect(notice).toBeVisible();
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(notice).toBeHidden();
});

test('文字のある PDF のとき、画像だけの案内は出ない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);

  await expect(page.locator('.page[data-page-number="1"] .textLayer')).toContainText('学年だより');
  await expect(page.getByText('文字が画像になっている')).toBeHidden();
});

test('読みの問い合わせに失敗したとき、もう一度を押すとルビが付く', async ({
  page,
  extensionId,
}) => {
  // 読みの問い合わせ（offscreen document へのメッセージ）だけを、印があるあいだ失敗させる
  await page.addInitScript((flag) => {
    const runtime = chrome.runtime as unknown as {
      sendMessage: (message: { type?: string }, ...rest: unknown[]) => Promise<unknown>;
    };
    const original = runtime.sendMessage.bind(chrome.runtime);
    runtime.sendMessage = (message, ...rest) =>
      (globalThis as Record<string, unknown>)[flag] === true && message.type === 'read-texts'
        ? Promise.reject(new Error('テストで失敗させた'))
        : original(message, ...rest);
    (globalThis as Record<string, unknown>)[flag] = true;
  }, FAIL_READINGS);

  await openFromFile(page, extensionId, HORIZONTAL_PRINT);

  await expect(page.getByText('ルビを付けられませんでした')).toBeVisible({
    timeout: RUBY_TIMEOUT_MS,
  });
  await expect(page.locator('.ruby-layer')).toHaveCount(0);

  await page.evaluate((flag) => {
    (globalThis as Record<string, unknown>)[flag] = false;
  }, FAIL_READINGS);
  await page.getByRole('button', { name: 'もう一度' }).click();

  await expect(page.locator('.page[data-page-number="1"] .ruby-layer')).toBeVisible({
    timeout: RUBY_TIMEOUT_MS,
  });
  await expect(page.getByText('ルビを付けられませんでした')).toBeHidden();
});

test('開けない URL のとき、ファイルを選んで開くと標準の表示で開くの2つのボタンが出る', async ({
  page,
  extensionId,
}) => {
  const pdfUrl = `${pdfOrigin}/missing.pdf`;
  await page.goto(
    `chrome-extension://${extensionId}/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
  );

  const actions = page.locator('#failure-actions');
  await expect(actions.getByRole('button', { name: 'ファイルを選んで開く' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Chrome の標準の表示で開く' })).toBeFocused();
});

test('開けない URL のあとにファイルを選んだとき、その PDF が開く', async ({
  page,
  extensionId,
}) => {
  const pdfUrl = `${pdfOrigin}/missing.pdf`;
  await page.goto(
    `chrome-extension://${extensionId}/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
  );
  const chooser = page.waitForEvent('filechooser');
  await page
    .locator('#failure-actions')
    .getByRole('button', { name: 'ファイルを選んで開く' })
    .click();
  await (await chooser).setFiles(join(TEST_PDF_DIR, HORIZONTAL_PRINT));

  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();
  await expect(page.locator('#failure-actions')).toBeHidden();
});

test('パスワード付きの PDF のとき、違うパスワードは入れ直せて、合うと開く', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを開く' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'locked.pdf',
    mimeType: 'application/pdf',
    buffer: buildEncryptedPdf(PASSWORD),
  });

  const input = page.getByLabel('この PDF にはパスワードがかかっています');
  await expect(input).toBeFocused();

  await input.fill('wrong-password');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'パスワードが違います。もう一度入れてください。',
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');

  await input.fill(PASSWORD);
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();
  await expect(input).toBeHidden();
});
