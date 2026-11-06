import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** ルビが付く、横書きのお知らせ（「弁当、水筒、敷物、雨具」がある） */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;

/** 右クリックする字と、もとのルビ・直したあとのルビ */
const BASE = '筒';
const ORIGINAL_RUBY = 'とう';
const FIXED_RUBY = 'つつ';
/** ルビのもとになった語と、もとの読み・直す読み */
const SURFACE = '水筒';
const ORIGINAL_READING = 'すいとう';
const FIXED_READING = 'すいつつ';

/**
 * ページ 1 の、読みを直す字のルビを引く。
 * @param page 画面
 * @returns ルビ
 */
function fixedRuby(page: Page): Locator {
  return page.locator(`.page[data-page-number="1"] .ruby-layer [data-base="${BASE}"]`);
}

/**
 * PDF を開き、ルビが出るのを待つ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param ruby 待つルビ
 */
async function openWithRuby(page: Page, extensionId: string, ruby: string): Promise<void> {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(fixedRuby(page)).toHaveText(ruby, { timeout: FIRST_RUBY_TIMEOUT_MS });
}

/**
 * ルビの真ん中を右クリックする（ルビの層は押せないので、位置で押す）。
 * @param page 画面
 */
async function rightClickRuby(page: Page): Promise<void> {
  const box = await fixedRuby(page).boundingBox();
  if (box === null) throw new Error('ルビが見えていない');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
}

/**
 * ルビを右クリックして、読みを直す窓を開く。
 * @param page 画面
 * @returns 読みを直す窓
 */
async function openFixDialog(page: Page): Promise<Locator> {
  await rightClickRuby(page);
  await page.getByRole('menuitem', { name: '読みを直す…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * service worker から、保存してある直した読みの組を読む。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @returns 言葉と読みの組
 */
async function storedEntries(context: BrowserContext): Promise<unknown> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(async () => {
    const items = await chrome.storage.sync.get('userDictionary.0');
    return (items['userDictionary.0'] as { entries?: unknown } | undefined)?.entries ?? [];
  });
}

/**
 * 設定の画面と同じく、リーダーの外（service worker）から storage.sync に直した読みを書く。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param entries 言葉と読みの組
 */
async function saveDictionary(
  context: BrowserContext,
  entries: readonly (readonly [string, string])[],
): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (pairs) => {
    const revision = crypto.randomUUID();
    await chrome.storage.sync.set({
      'userDictionary.0': { revision, entries: pairs },
      userDictionary: { revision, chunkCount: 1 },
    });
  }, entries);
}

test('ルビを右クリックしたとき、メニューの頭にルビの見出しと「読みを直す…」を出す', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);

  await rightClickRuby(page);

  const menu = page.getByRole('menu');
  await expect(menu.getByText(`「${BASE}（${ORIGINAL_RUBY}）」のルビ`)).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    '読みを直す…',
    '文字の向きを直す…',
    'ルビの設定を開く',
  ]);
  await expect(menu.getByRole('menuitem', { name: '読みを直す…' })).toBeFocused();
});

test('読みを直す窓を開いたとき、ルビのもとになった語と、語全体の今の読みを出す', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);

  const dialog = await openFixDialog(page);

  await expect(dialog.getByRole('heading')).toContainText(SURFACE);
  await expect(dialog.getByLabel('読み（ひらがな）')).toHaveValue(ORIGINAL_READING);
  await expect(dialog.getByLabel('読み（ひらがな）')).toBeFocused();
  await expect(dialog.getByRole('button', { name: '元に戻す' })).toBeHidden();
});

test('読みを変えて決めたとき、ルビが変わり、設定の画面の一覧に入る', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);
  const dialog = await openFixDialog(page);

  await dialog.getByLabel('読み（ひらがな）').fill(FIXED_READING);
  await dialog.getByRole('button', { name: '決める' }).click();

  await expect(dialog).toBeHidden();
  await expect(fixedRuby(page)).toHaveText(FIXED_RUBY);
  await expect(page.getByRole('status').filter({ hasText: SURFACE })).toHaveText(
    `「${SURFACE}」の読みを「${FIXED_READING}」にしました。`,
  );
  expect(await storedEntries(context)).toEqual([[SURFACE, FIXED_READING]]);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    options.getByRole('list', { name: '直した読み' }).getByRole('listitem').filter({
      hasText: SURFACE,
    }),
  ).toHaveCount(1);
});

test('直した読みのある語で元に戻すを押したとき、ルビがもとに戻り、直した読みが消える', async ({
  page,
  context,
  extensionId,
}) => {
  await saveDictionary(context, [[SURFACE, FIXED_READING]]);
  await openWithRuby(page, extensionId, FIXED_RUBY);
  const dialog = await openFixDialog(page);
  await expect(dialog.getByLabel('読み（ひらがな）')).toHaveValue(FIXED_READING);

  await dialog.getByRole('button', { name: '元に戻す' }).click();

  await expect(dialog).toBeHidden();
  await expect(fixedRuby(page)).toHaveText(ORIGINAL_RUBY);
  expect(await storedEntries(context)).toEqual([]);
});

test('窓で Esc を押したとき、保存せずに閉じ、焦点が紙面に戻る', async ({
  page,
  context,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);
  const dialog = await openFixDialog(page);
  await dialog.getByLabel('読み（ひらがな）').fill(FIXED_READING);

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(page.locator('#viewer-container')).toBeFocused();
  expect(await storedEntries(context)).toEqual([]);
});

test('ひらがなでない読みで決めたとき、欄の下に理由を出し、窓を閉じない', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);
  const dialog = await openFixDialog(page);
  const field = dialog.getByLabel('読み（ひらがな）');

  await field.fill('スイツツ');
  await dialog.getByRole('button', { name: '決める' }).click();

  await expect(dialog).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(/読みはひらがなで入れてください。/);
  await expect(fixedRuby(page)).toHaveText(ORIGINAL_RUBY);
});

test('紙面で Shift+F10 を押したとき、キーボードだけで窓を開いて読みを直せる', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId, ORIGINAL_RUBY);
  await page.locator('#viewer-container').focus();

  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '読みを直す…' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('読み（ひらがな）')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#viewer-container')).toBeFocused();
});
