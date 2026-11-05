import type { BrowserContext, Page } from '@playwright/test';

import { SAMPLE_PDF_PATH } from '../../src/config';
import { expect, test } from './fixtures';

/** 入れた直後の案内の見出し */
const WELCOME_TITLE = 'インストールありがとうございます';

/** 見本の PDF の1ページめ（縦書き）でルビが付くはずの字と読み */
const SAMPLE_RUBY = { base: '庭', reading: 'にわ' };

/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;

/**
 * 入れたときに background が開いた設定の画面を探す。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param extensionId 入れた拡張の ID
 * @returns 設定の画面
 */
function openedOptions(context: BrowserContext, extensionId: string): Page {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const page = context.pages().find((candidate) => candidate.url() === optionsUrl);
  if (page === undefined) {
    throw new Error('入れたときに設定の画面が開いていない');
  }
  return page;
}

test('初めて入れたとき、開いた設定の画面に案内が出る', async ({ context, extensionId }) => {
  const page = openedOptions(context, extensionId);

  await expect(page.getByRole('heading', { level: 2, name: WELCOME_TITLE })).toBeVisible();
  await expect(page.getByText('下のスイッチをオンにしてください')).toBeVisible();
});

test('「見本の PDF で試す」を押したとき、見本がルビ付きでリーダーに開く', async ({
  context,
  extensionId,
}) => {
  const page = openedOptions(context, extensionId);

  const [reader] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: '見本の PDF で試す' }).click(),
  ]);

  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(
    SAMPLE_PDF_PATH.slice(SAMPLE_PDF_PATH.lastIndexOf('/') + 1),
  );
  await expect(
    reader
      .locator(`.page[data-page-number="1"] .ruby-layer [data-base="${SAMPLE_RUBY.base}"]`)
      .first(),
  ).toHaveText(SAMPLE_RUBY.reading, { timeout: FIRST_RUBY_TIMEOUT_MS });
});

test('「閉じる」を押したとき、案内が消えて画面の見出しに移る', async ({ context, extensionId }) => {
  const page = openedOptions(context, extensionId);
  await expect(page.getByRole('heading', { name: WELCOME_TITLE })).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: WELCOME_TITLE })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('案内を閉じたあと開き直したとき、案内は出ない', async ({ context, extensionId }) => {
  const page = openedOptions(context, extensionId);
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('heading', { name: WELCOME_TITLE })).toHaveCount(0);

  await page.reload();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ルビの設定');
  await expect(page.getByRole('button', { name: '見本の PDF で試す' })).toHaveCount(0);
});
