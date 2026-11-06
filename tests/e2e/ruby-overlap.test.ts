import type { BrowserContext, Page } from '@playwright/test';
import type { browser } from 'wxt/browser';

import { expect, openFromFile, test } from './fixtures';

/** service worker の中で動かす関数から使う、拡張の API（型だけ） */
declare const chrome: typeof browser;

/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 重なりと見なさない、画面の上の長さ（px。端どうしが触れるだけのときの丸めの誤差） */
const TOUCH_PX = 0.5;
/** 縦書きのお話と横書きの記録のある、同梱の見本 */
const SAMPLE = 'sample.pdf';

/** 画面の上の箱 */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 描いたルビの1つ */
interface DrawnRuby {
  readonly base: string;
  readonly ruby: string;
  readonly isVertical: boolean;
  /** span の箱 */
  readonly box: Box;
  /** 字を並べた所の箱 */
  readonly text: Box;
  /** 字の大きさ（px） */
  readonly fontSize: number;
}

/**
 * 設定の画面と同じく、リーダーの外（service worker）から storage.sync に直した読みを書く。
 * 保存の形は src/settings/user-dictionary.ts の目次と中身（1つ）に合わせる。
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

/**
 * ページのルビを、画面の上の箱で測る。同梱のフォントを読み終えてから測る。
 * @param page 画面
 * @param pageNumber ページ番号
 * @returns 描いたルビ
 */
async function measureRubies(page: Page, pageNumber: number): Promise<DrawnRuby[]> {
  return page.evaluate(async (number) => {
    await document.fonts.ready;
    const spans = document.querySelectorAll<HTMLElement>(
      `.page[data-page-number="${number}"] .ruby-layer > span`,
    );
    const toBox = (rect: DOMRect): Box => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
    return [...spans].map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      return {
        base: span.dataset.base ?? '',
        ruby: span.textContent,
        isVertical: span.classList.contains('ruby-vertical'),
        box: toBox(span.getBoundingClientRect()),
        text: toBox(range.getBoundingClientRect()),
        fontSize: Number.parseFloat(getComputedStyle(span).fontSize),
      };
    });
  }, String(pageNumber));
}

/**
 * 2つの箱が重なるか。端どうしが触れるだけなら重ならない。
 * @param a 箱
 * @param b 箱
 * @returns 重なれば true
 */
function isOverlapping(a: Box, b: Box): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOUCH_PX &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOUCH_PX
  );
}

/**
 * 重なるルビの組を、親字とルビの文字で出す。
 * @param rubies 描いたルビ
 * @param boxOf 比べる箱
 * @returns 重なる組（例：「便/びん × 受/う」）
 */
function overlappingPairs(rubies: readonly DrawnRuby[], boxOf: (ruby: DrawnRuby) => Box): string[] {
  const label = (ruby: DrawnRuby): string => `${ruby.base}/${ruby.ruby}`;
  return rubies.flatMap((a, i) =>
    rubies
      .slice(i + 1)
      .filter((b) => isOverlapping(boxOf(a), boxOf(b)))
      .map((b) => `${label(a)} × ${label(b)}`),
  );
}

/**
 * 字が span の箱から、行の向き（縦書きは上下、横書きは左右）にあふれているルビを出す。
 * 行と交わる向きは、字の箱がフォントの上と下の高さの和（1字より大きい）になるので比べない。
 * @param rubies 描いたルビ
 * @returns あふれているルビの親字
 */
function overflowing(rubies: readonly DrawnRuby[]): string[] {
  return rubies
    .filter(({ box, text, isVertical }) =>
      isVertical
        ? text.top < box.top - TOUCH_PX || text.bottom > box.bottom + TOUCH_PX
        : text.left < box.left - TOUCH_PX || text.right > box.right + TOUCH_PX,
    )
    .map((ruby) => ruby.base);
}

for (const file of [SAMPLE, 'vertical-story.pdf', 'horizontal-print.pdf']) {
  test(`${file} を開いたとき、描いたルビの箱も字も、ほかのルビと重ならない`, async ({
    page,
    extensionId,
  }) => {
    await openFromFile(page, extensionId, file);
    await expect(
      page.locator('.page[data-page-number="1"] .ruby-layer > span').first(),
    ).toBeAttached({ timeout: FIRST_RUBY_TIMEOUT_MS });

    const rubies = await measureRubies(page, 1);

    expect(rubies.length).toBeGreaterThan(0);
    expect(overlappingPairs(rubies, (ruby) => ruby.box)).toEqual([]);
    expect(overlappingPairs(rubies, (ruby) => ruby.text)).toEqual([]);
    expect(overflowing(rubies)).toEqual([]);
  });
}

test('直した読みで長いルビが縦書きで隣り合うとき、重ならず、字の大きさと箱の太さが合う', async ({
  page,
  context,
  extensionId,
}) => {
  // 見本の縦書きのお話の「差出人の名前」。どちらも親字よりずっと長い読みにする
  await saveDictionary(context, [
    ['差出人', 'さしだしにんさしだしにん'],
    ['名前', 'なまえなまえなまえ'],
  ]);
  await openFromFile(page, extensionId, SAMPLE);
  const layer = page.locator('.page[data-page-number="1"] .ruby-layer');
  await expect(layer.locator('[data-base="差出人"]')).toHaveText('さしだしにんさしだしにん', {
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });
  await expect(layer.locator('[data-base="名前"]')).toHaveText('なまえなまえなまえ');

  const rubies = await measureRubies(page, 1);
  const fixed = rubies.filter((ruby) => ruby.base === '差出人' || ruby.base === '名前');

  expect(fixed.map((ruby) => ruby.isVertical)).toEqual([true, true]);
  expect(overlappingPairs(rubies, (ruby) => ruby.box)).toEqual([]);
  expect(overlappingPairs(rubies, (ruby) => ruby.text)).toEqual([]);
  expect(overflowing(rubies)).toEqual([]);
  for (const ruby of fixed) {
    expect(ruby.fontSize).toBeCloseTo(ruby.box.right - ruby.box.left, 0);
  }
});
