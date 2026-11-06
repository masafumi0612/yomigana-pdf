import { expect, openFromFile, test } from './fixtures';

/** 縦書きの印がなく、向きを直せる案内が出る Word の PDF */
const UNMARKED_VERTICAL = 'word/word-vertical.pdf';
/** ルビが出るまで待つ時間の上限（ミリ秒）。辞書の読み込みを含む */
const RUBY_TIMEOUT_MS = 15_000;

test('印刷の見た目のとき、バーと案内が見えず、紙面は見える', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });
  await expect(page.locator('#bar')).toBeVisible();
  await expect(page.getByText('文字の向きが違うところがあれば直せます')).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('#bar')).toBeHidden();
  await expect(page.locator('.notices .notice').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.page[data-page-number="1"]')).toBeVisible();
});

test('印刷の見た目のとき、向きを直す枠と切り替えが見えない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, UNMARKED_VERTICAL);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: RUBY_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: '直す' }).click();
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
