import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import { expect, hostAccessTest, setAutoRedirect, test, TEST_PDF_DIR } from './fixtures';

/** 拡張の画面の中で動かす関数から使う、拡張の API（型だけ。中身は拡張の画面にある） */
declare const chrome: typeof browser;

/** 開くテスト用 PDF。ルビが付くはずの字と読み */
const PDF = { file: 'horizontal-print.pdf', base: '筒', reading: 'とう' };

/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;

/** 目当ての場所に着くまで Tab を押す回数の上限 */
const MAX_TABS = 30;

let server: Server;
let pdfOrigin: string;

// URL から開くのを確かめるため、テスト用 PDF を返すだけのサーバーを立てる
test.beforeAll(async () => {
  const data = await readFile(join(TEST_PDF_DIR, PDF.file));
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf' });
    response.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  pdfOrigin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * 設定の画面の URL を作る。
 * @param extensionId 入れた拡張の ID
 * @returns 設定の画面の URL
 */
function optionsUrlOf(extensionId: string): string {
  return `chrome-extension://${extensionId}/options.html`;
}

/**
 * 設定の画面を開く。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openOptions(page: Page, extensionId: string): Promise<void> {
  await page.goto(optionsUrlOf(extensionId));
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
 * 保存してある親スイッチの値を読む。
 * @param page 拡張の画面
 * @returns 保存してある値
 */
async function storedAutoRedirect(page: Page): Promise<unknown> {
  return page.evaluate(async () => (await chrome.storage.sync.get('autoRedirect')).autoRedirect);
}

/**
 * 親スイッチを引く。
 * @param page 画面
 * @returns スイッチ
 */
function autoSwitch(page: Page): Locator {
  return page.getByRole('switch', { name: 'PDF を開いたら、自動でルビを付ける' });
}

test('初めて入れたとき、設定の画面がタブで開く', async ({ context, extensionId }) => {
  const optionsUrl = optionsUrlOf(extensionId);

  await expect.poll(() => context.pages().some((page) => page.url() === optionsUrl)).toBe(true);
});

test('Tab で移ったとき、移った場所に枠が見える', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);

  await tabTo(page, autoSwitch(page));

  await expect(autoSwitch(page)).toHaveCSS('outline-style', 'solid');
});

hostAccessTest(
  'キーボードでスイッチをオンにしたとき、オンが保存される',
  async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');

    await tabTo(page, autoSwitch(page));
    await page.keyboard.press('Space');

    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => storedAutoRedirect(page)).toBe(true);
  },
);

hostAccessTest(
  'オンのスイッチを Enter で押したとき、オフが保存される',
  async ({ page, extensionId, context }) => {
    await setAutoRedirect(
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      true,
    );
    await openOptions(page, extensionId);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');

    await tabTo(page, autoSwitch(page));
    await page.keyboard.press('Enter');

    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => storedAutoRedirect(page)).toBe(false);
  },
);

hostAccessTest(
  'ほかの画面でスイッチの値が変わったとき、画面のスイッチも変わる',
  async ({ page, extensionId, context }) => {
    await openOptions(page, extensionId);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');

    await setAutoRedirect(
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      true,
    );

    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');
  },
);

hostAccessTest(
  '設定を最初の状態にもどしたとき、スイッチがオフになる',
  async ({ page, extensionId, context }) => {
    await setAutoRedirect(
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      true,
    );
    await openOptions(page, extensionId);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');

    await tabTo(page, page.getByRole('button', { name: '設定を最初の状態にもどす' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'やめる' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'もどす', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status')).toHaveText('設定を最初の状態にもどしました。');
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => storedAutoRedirect(page)).toBe(false);
  },
);

test('もどすのをやめたとき、設定は変わらない', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const reset = page.getByRole('button', { name: '設定を最初の状態にもどす' });

  await tabTo(page, reset);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'やめる' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: 'もどす', exact: true })).toBeHidden();
  await expect(reset).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('');
});

hostAccessTest(
  'Web の PDF の URL を入れて Enter を押したとき、ルビ付きでリーダーが開く',
  async ({ page, extensionId, context }) => {
    await openOptions(page, extensionId);
    const pdfUrl = `${pdfOrigin}/${PDF.file}`;

    await tabTo(page, page.getByLabel('Web の PDF の URL'));
    await page.keyboard.type(pdfUrl);
    const [reader] = await Promise.all([
      context.waitForEvent('page'),
      page.keyboard.press('Enter'),
    ]);

    await expect(reader).toHaveURL(
      `chrome-extension://${extensionId}/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
    );
    await expect(reader.locator('#page-total')).toHaveText('/ 1');
  },
);

test('http・https でない URL を入れたとき、開かずに理由が出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const field = page.getByLabel('Web の PDF の URL');

  await tabTo(page, field);
  await page.keyboard.type('example.com/a.pdf');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert').filter({ hasText: 'URL' })).toHaveText(
    'http:// か https:// で始まる URL を入れてください。',
  );
  await expect(field).toHaveAttribute('aria-invalid', 'true');
});

test('パソコンの PDF を選んだとき、ルビ付きでリーダーが開く', async ({
  page,
  extensionId,
  context,
}) => {
  await openOptions(page, extensionId);

  await tabTo(page, page.getByRole('button', { name: 'パソコンの PDF を選ぶ' }));
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const [reader] = await Promise.all([
    context.waitForEvent('page'),
    (await chooser).setFiles(join(TEST_PDF_DIR, PDF.file)),
  ]);

  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(PDF.file);
  await expect(
    reader.locator(`.page[data-page-number="1"] .ruby-layer [data-base="${PDF.base}"]`),
  ).toHaveText(PDF.reading, { timeout: FIRST_RUBY_TIMEOUT_MS });
});

test('PDF でないファイルを選んだとき、開かずに理由が出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);

  await tabTo(page, page.getByRole('button', { name: 'パソコンの PDF を選ぶ' }));
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (
    await chooser
  ).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('png') });

  await expect(page.getByRole('alert').filter({ hasText: 'PDF' })).toHaveText(
    'PDF のファイルを選んでください。',
  );
});

test('ファイルの URL へのアクセスが許可されていないとき、許可の手順を開ける', async ({
  page,
  extensionId,
}) => {
  // コマンドで入れた拡張には最初から許可があるので、許可がないことにする
  await page.addInitScript(() => {
    chrome.extension.isAllowedFileSchemeAccess = () => Promise.resolve(false);
  });
  await openOptions(page, extensionId);
  await expect(page.getByText('Chrome の許可が必要')).toBeVisible();
  const steps = page.getByRole('button', { name: '許可の手順' });

  await tabTo(page, steps);
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: '手順を閉じる' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('button', { name: '拡張機能の設定を開く' })).toBeVisible();
});

test('ファイルの URL へのアクセスが許可されているとき、許可されていると出る', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await expect(page.getByText('Chrome で許可されています')).toBeVisible();
  await expect(page.getByRole('button', { name: '許可の手順' })).toHaveCount(0);
});

test('「ライセンスと出典」を押したとき、同梱した文書が開く', async ({
  page,
  extensionId,
  context,
}) => {
  await openOptions(page, extensionId);

  await tabTo(page, page.getByRole('link', { name: 'ライセンスと出典' }));
  const [notices] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')]);

  await expect(notices).toHaveURL(`chrome-extension://${extensionId}/THIRD_PARTY_NOTICES.md`);
  await expect(notices.locator('body')).toContainText('kuromoji');
});

test('拡張の版が出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);

  const version = await page.evaluate(() => chrome.runtime.getManifest().version);
  await expect(page.getByText(`バージョン ${version} ・ MIT ライセンス`)).toBeVisible();
});
