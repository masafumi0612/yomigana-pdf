import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { Settings } from '../../src/settings/model';
import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** ルビが付く、横書きのお知らせ */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 開き直していないかを見る印（リーダーの画面の中の変数名） */
const NOT_RELOADED = '__notReloaded';
/** 目当ての場所に着くまで Tab を押す回数の上限 */
const MAX_TABS = 40;
/** 1年生で習う字（「11月号」などに出る。小学校のどの段階でもルビが消える） */
const FIRST_GRADE_CHAR = '月';
/** 小学校のまとまりの選択肢の数（なし・1〜6年）。この数だけ右に動くと、中1の目安に着く */
const ELEMENTARY_LEVEL_COUNT = 7;

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
 * 保存してある設定を、service worker から読む。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @returns 保存してある設定
 */
async function storedSettings(context: BrowserContext): Promise<Partial<Settings>> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(async () => chrome.storage.sync.get(['level']));
}

/**
 * ページ 1 のルビの親字を、出ている順に挙げる。
 * @param page リーダーの画面
 * @returns 親字
 */
async function rubyBases(page: Page): Promise<string[]> {
  return page
    .locator('.page[data-page-number="1"] .ruby-layer span')
    .evaluateAll((spans) =>
      spans.map((span) => (span instanceof HTMLElement ? (span.dataset.base ?? '') : '')),
    );
}

test('段階の欄で矢印キーを押したとき、選んだ段階が保存され、いまの設定に出る', async ({
  page,
  context,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await tabTo(page, page.getByRole('radio', { name: /^なし/ }));

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  await expect(page.getByRole('radio', { name: /^3年まで/ })).toBeChecked();
  await expect(page.getByText('いまの設定：3年までの漢字には付けない')).toBeVisible();
  await expect.poll(async () => (await storedSettings(context)).level).toBe('g3');
});

test('段階の欄で矢印キーを押したとき、小学校から中学・高校のまとまりへ続けて移る', async ({
  page,
  context,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await tabTo(page, page.getByRole('radio', { name: /^なし/ }));

  for (let count = 0; count < ELEMENTARY_LEVEL_COUNT; count += 1) {
    await page.keyboard.press('ArrowRight');
  }

  await expect(page.getByRole('radio', { name: /^中1まで（目安）/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^中1まで（目安）/ })).toBeFocused();
  await expect.poll(async () => (await storedSettings(context)).level).toBe('m1');
});

test('段階の欄に、それぞれの段階までの字の数と、中学の目安の注意が出る', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await expect(page.getByRole('radio', { name: 'なし すべての漢字にルビ' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '1年まで 80字' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '6年まで 1,026字' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '常用漢字すべて 2,136字' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: '中学・高校（常用漢字）' }),
  ).toHaveAccessibleDescription(
    '中1・中2は、よく使われる順に字数で区切った目安です。教科書の学年とは一致しません。',
  );
  await expect(page.getByText('いまの設定：すべての漢字に付ける')).toBeVisible();
});

test('どの範囲でもルビが付く文字の見本が、ルビ付きで出る', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const examples = page.getByRole('list', { name: '次の文字は、どの範囲を選んでもルビが付きます' });

  await expect(examples.getByRole('listitem')).toHaveCount(3);
  await expect(examples.locator('ruby rt')).toHaveText([
    'ば',
    'ら',
    'れ',
    'もん',
    'きょう',
    'おとな',
    'あいにく',
    'からだ',
  ]);
});

test('見出しの横に、変更がすぐ保存され、開いている PDF にも反映されることが出る', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await expect(page.getByText('変更はすぐ保存され、開いている PDF にも反映されます')).toBeVisible();
});

test('設定の画面でキーボードだけで段階を変えたとき、開いているリーダーのルビとバーの文字が開き直さずに変わる', async ({
  page,
  context,
  extensionId,
}) => {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });
  expect((await rubyBases(page)).some((base) => base.includes(FIRST_GRADE_CHAR))).toBe(true);
  await page.evaluate((flag) => {
    (globalThis as Record<string, unknown>)[flag] = true;
  }, NOT_RELOADED);
  const options = await context.newPage();
  await openOptions(options, extensionId);

  await tabTo(options, options.getByRole('radio', { name: /^なし/ }));
  await options.keyboard.press('ArrowRight');
  await options.keyboard.press('ArrowRight');
  await options.keyboard.press('ArrowRight');

  await expect(page.getByRole('button', { name: /^ルビ：/ })).toHaveText(
    'ルビ：3年までの漢字には付けない',
  );
  await expect
    .poll(async () => (await rubyBases(page)).some((base) => base.includes(FIRST_GRADE_CHAR)))
    .toBe(false);
  expect(
    await page.evaluate((flag) => (globalThis as Record<string, unknown>)[flag], NOT_RELOADED),
  ).toBe(true);
});
