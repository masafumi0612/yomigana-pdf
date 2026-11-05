import type { browser } from 'wxt/browser';

import { expect, test } from './fixtures';

/** 拡張の画面の中で動かす関数から使う、拡張の API（型だけ。中身は拡張の画面にある） */
declare const chrome: typeof browser;

/** ほかの部品で出たことにするエラー。文に PDF の URL が混じっている */
const STORED_ERROR = {
  time: '2026-11-06T01:00:00.000Z',
  scope: 'viewer',
  message: 'PDF を読めませんでした：Missing PDF "https://example.com/school/print.pdf".',
};

test('「報告用の情報をコピー」を押したとき、版と直近のエラーが URL なしでコピーされる', async ({
  context,
  page,
  extensionId,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(async (record) => {
    await chrome.storage.local.set({ recentErrors: [record] });
  }, STORED_ERROR);
  const version = await page.evaluate(() => chrome.runtime.getManifest().version);

  await page.getByRole('button', { name: '報告用の情報をコピー' }).click();

  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'コピー' })).toHaveText(
    'コピーしました',
  );
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows のクリップボードは改行を CRLF にする
  const [first, second] = copied.split(/\r?\n/u);
  expect([first, second?.startsWith('ブラウザ：Chrom')]).toEqual([`よみがなPDF ${version}`, true]);
  expect(copied).toContain('[viewer] PDF を読めませんでした：Missing PDF');
  expect(copied).not.toContain('example.com');
});
