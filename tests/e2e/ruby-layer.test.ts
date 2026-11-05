import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { EXPECTATIONS } from '../../scripts/test-pdfs/expectations';
import { expect, openFromFile, test, TEST_PDF_DIR } from './fixtures';

/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** 位置を比べるときのゆとり（親字の大きさに対する割合） */
const TOLERANCE_EM = 0.3;
/** 目安：見えているページにルビが付くまで（ミリ秒）。測って残すだけで、テストは止めない */
const TARGET_PAGE_MS = 300;
/** 目安：辞書を初めて読み込むときの読みの問い合わせ（ミリ秒） */
const TARGET_FIRST_READING_MS = 2000;

/** ルビの層の名前（src/viewer/ruby-pages.ts の performance.measure） */
const READINGS_MEASURE = 'yomigana-pdf:readings';
const RUBY_LAYER_MEASURE = 'yomigana-pdf:ruby-layer';

/** 画面の上の箱 */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** ルビと、その親字（文字の層の中の字）の箱 */
interface RubyAndBase {
  readonly ruby: Box;
  readonly base: Box;
}

/**
 * ページのルビの層を引く。
 * @param page 画面
 * @param pageNumber ページ番号
 * @returns ルビの層
 */
function rubyLayer(page: Page, pageNumber: number): Locator {
  return page.locator(`.page[data-page-number="${String(pageNumber)}"] .ruby-layer`);
}

/**
 * 1字の親字のルビと、文字の層の中でいちばん近いその字の箱を測る。
 * @param page 画面
 * @param pageNumber ページ番号
 * @param base 親字（ページに1つだけ出る字にする）
 * @returns ルビと親字の箱
 */
async function measureRuby(page: Page, pageNumber: number, base: string): Promise<RubyAndBase> {
  return page.evaluate(
    ([number, ch]) => {
      const pageDiv = document.querySelector(`.page[data-page-number="${number}"]`);
      const ruby = [...(pageDiv?.querySelectorAll<HTMLElement>('.ruby-layer > span') ?? [])].find(
        (element) => element.dataset.base === ch,
      );
      const walker = document.createTreeWalker(
        pageDiv?.querySelector('.textLayer') ?? document.body,
        NodeFilter.SHOW_TEXT,
      );
      let rect: DOMRect | undefined;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(ch) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + ch.length);
        rect = range.getBoundingClientRect();
        break;
      }
      const toBox = (r: DOMRect | undefined): Box => ({
        left: r?.left ?? Number.NaN,
        right: r?.right ?? Number.NaN,
        top: r?.top ?? Number.NaN,
        bottom: r?.bottom ?? Number.NaN,
      });
      return { ruby: toBox(ruby?.getBoundingClientRect()), base: toBox(rect) };
    },
    [String(pageNumber), base] as const,
  );
}

// 文字の層の字の箱は、pdf.js が代わりのフォントで近づけたもので、縦書きでは幅が字より広く出る。
// そのため端どうしではなく、中心どうしを比べる

/**
 * ルビが縦書きの親字の右にあるか。
 * @param measured ルビと親字の箱
 * @returns ルビの中心が親字の中心より右にあり、上下の中心が親字にかかっていれば true
 */
function isRightOf(measured: RubyAndBase): boolean {
  const { ruby, base } = measured;
  const middle = (ruby.top + ruby.bottom) / 2;
  return (
    (ruby.left + ruby.right) / 2 > (base.left + base.right) / 2 &&
    middle > base.top &&
    middle < base.bottom
  );
}

/**
 * ルビが横書きの親字の上にあるか。
 * @param measured ルビと親字の箱
 * @returns ルビの中心が親字の上の端より上にあり、左右の中心が親字にかかっていれば true
 */
function isAbove(measured: RubyAndBase): boolean {
  const { ruby, base } = measured;
  const middle = (ruby.left + ruby.right) / 2;
  return (
    (ruby.top + ruby.bottom) / 2 < base.top + (base.bottom - base.top) * TOLERANCE_EM &&
    middle > base.left &&
    middle < base.right
  );
}

test('テスト用 PDF を開いたとき、ルビの層が出て、画面の読み上げからは外れる', async ({
  page,
  extensionId,
}) => {
  await openFromFile(page, extensionId, 'vertical-story.pdf');

  const layer = rubyLayer(page, 1);
  await expect(layer.locator('span').first()).toBeAttached({ timeout: FIRST_RUBY_TIMEOUT_MS });
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
});

test('縦書きのとき、ルビが字の右に出る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, 'vertical-story.pdf');
  await expect(rubyLayer(page, 1).locator('[data-base="傘"]')).toHaveText('かさ', {
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  expect(isRightOf(await measureRuby(page, 1, '傘'))).toBe(true);
});

test('横書きのとき、ルビが字の上に出る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, 'horizontal-print.pdf');
  await expect(rubyLayer(page, 1).locator('[data-base="筒"]')).toHaveText('とう', {
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  expect(isAbove(await measureRuby(page, 1, '筒'))).toBe(true);
});

/**
 * ルビの font-family と、そのフォントを読み込めたかを調べる。
 * @param page 画面
 * @param base 親字（ページに1つだけ出る字にする）
 * @returns 今の font-family と、読み込んだ同梱フォントの family
 */
async function rubyFont(
  page: Page,
  base: string,
): Promise<{ family: string; loaded: string[]; hasGlyphs: boolean }> {
  return page.evaluate(async (ch) => {
    const ruby = [...document.querySelectorAll<HTMLElement>('.ruby-layer > span')].find(
      (element) => element.dataset.base === ch,
    );
    const family = ruby === undefined ? '' : getComputedStyle(ruby).fontFamily;
    await document.fonts.load(`16px ${family}`, ruby?.textContent ?? '');
    return {
      family,
      loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((f) => f.family),
      hasGlyphs: document.fonts.check(`16px ${family}`, ruby?.textContent ?? ''),
    };
  }, base);
}

test('明朝の PDF のとき、ルビが同梱の明朝になる', async ({ page, extensionId }) => {
  // 縦書きの物語の本文は Noto Serif JP
  expect(EXPECTATIONS['vertical-story']?.fonts).toContain('NotoSerifJP-Regular');
  await openFromFile(page, extensionId, 'vertical-story.pdf');
  await expect(rubyLayer(page, 1).locator('[data-base="傘"]')).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  const font = await rubyFont(page, '傘');

  expect(font.family).toContain('Yomigana Ruby Serif');
  expect(font.loaded).toContain('Yomigana Ruby Serif');
  expect(font.hasGlyphs).toBe(true);
});

test('ゴシックの PDF のとき、ルビが同梱のゴシックになる', async ({ page, extensionId }) => {
  // 学年だよりは Noto Sans JP だけ
  expect(
    EXPECTATIONS['horizontal-print']?.fonts.every((name) => name.startsWith('NotoSansJP')),
  ).toBe(true);
  await openFromFile(page, extensionId, 'horizontal-print.pdf');
  await expect(rubyLayer(page, 1).locator('[data-base="筒"]')).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  const font = await rubyFont(page, '筒');

  expect(font.family).toContain('Yomigana Ruby Sans');
  expect(font.loaded).toContain('Yomigana Ruby Sans');
  expect(font.hasGlyphs).toBe(true);
});

test('もとからルビのある字のとき、ルビを重ねて付けない', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, 'existing-ruby.pdf');
  const layer = rubyLayer(page, 1);
  // 「漂着」の「漂」にだけもとからルビがあるので、「着」には付く
  await expect(layer.locator('[data-base="着"]')).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  // もとからルビのある字のうち、このページでルビなしでは出てこない字
  const withRubyOnly = Array.from('港私栞壺漂陶遥承');
  expect(withRubyOnly.every((ch) => EXPECTATIONS['existing-ruby']?.rubyOn?.includes(ch))).toBe(
    true,
  );
  const bases = await layer
    .locator('span')
    .evaluateAll((spans) =>
      spans.map((span) => (span instanceof HTMLElement ? (span.dataset.base ?? '') : '')),
    );
  expect(bases.filter((base) => withRubyOnly.some((ch) => base.includes(ch)))).toEqual([]);
});

test('拡大したとき、ルビが字に付いてくる', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, 'horizontal-print.pdf');
  const ruby = rubyLayer(page, 1).locator('[data-base="筒"]');
  await expect(ruby).toBeAttached({ timeout: FIRST_RUBY_TIMEOUT_MS });
  const before = await measureRuby(page, 1, '筒');

  await page.getByRole('button', { name: '拡大' }).click();
  await page.getByRole('button', { name: '拡大' }).click();

  await expect
    .poll(async () => {
      const after = await measureRuby(page, 1, '筒');
      return after.ruby.right - after.ruby.left > (before.ruby.right - before.ruby.left) * 1.2;
    })
    .toBe(true);
  expect(isAbove(await measureRuby(page, 1, '筒'))).toBe(true);
});

test('ルビが付くまでの時間を測る（目安を超えても止めない）', async ({ page, extensionId }) => {
  // 辞書を初めて読み込むとき
  await openFromFile(page, extensionId, 'vertical-story.pdf');
  await expect(rubyLayer(page, 1).locator('span').first()).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });
  const [coldReading = Number.NaN] = await durations(page, READINGS_MEASURE);
  const coldLayer = Math.max(...(await durations(page, RUBY_LAYER_MEASURE)));

  // 辞書を読み込んだあとに、別の PDF を開いたとき
  const readingsBefore = (await durations(page, READINGS_MEASURE)).length;
  const layersBefore = (await durations(page, RUBY_LAYER_MEASURE)).length;
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを開く' }).click();
  await (await chooser).setFiles(join(TEST_PDF_DIR, 'horizontal-print.pdf'));
  await expect(rubyLayer(page, 1).locator('[data-base="筒"]')).toBeAttached();
  const warmReadings = (await durations(page, READINGS_MEASURE)).slice(readingsBefore);
  const warmLayers = (await durations(page, RUBY_LAYER_MEASURE)).slice(layersBefore);

  // 拡大して置き直したとき
  await page.getByRole('button', { name: '拡大' }).click();
  await expect
    .poll(async () => (await durations(page, RUBY_LAYER_MEASURE)).length)
    .toBeGreaterThan(layersBefore + warmLayers.length);
  const zoomLayer = (await durations(page, RUBY_LAYER_MEASURE)).at(-1) ?? Number.NaN;

  const format = (values: readonly number[]): string =>
    values.map((ms) => ms.toFixed(0)).join('・');
  test.info().annotations.push(
    {
      type: 'timing',
      description: `辞書の読み込みを含む最初の読みの問い合わせ ${coldReading.toFixed(0)} ms・ルビが付くまで ${coldLayer.toFixed(0)} ms（目安 ${String(TARGET_FIRST_READING_MS)} ms）`,
    },
    {
      type: 'timing',
      description: `辞書を読み込んだあと：読みの問い合わせ ${format(warmReadings)} ms・描き終えてからルビが付くまで ${format(warmLayers)} ms・拡大で置き直し ${zoomLayer.toFixed(0)} ms（目安 ${String(TARGET_PAGE_MS)} ms）`,
    },
  );
  expect(Number.isFinite(coldLayer) && warmLayers.length > 0).toBe(true);
});

/**
 * 測った時間を引く。
 * @param page 画面
 * @param name performance.measure の名前
 * @returns 測った順の時間（ミリ秒）
 */
async function durations(page: Page, name: string): Promise<number[]> {
  return page.evaluate(
    (measureName) =>
      performance.getEntriesByName(measureName, 'measure').map((entry) => entry.duration),
    name,
  );
}

/** 親字から見たルビの側 */
type Side = 'top' | 'right' | 'bottom' | 'left';

/** 時計回りに 90 度ずつ回したときの、ルビの側の移り方 */
const CLOCKWISE: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * ルビが親字のどちら側にあるか。中心どうしの差が大きいほうの向きで決める。
 * @param measured ルビと親字の箱
 * @returns ルビの側
 */
function sideOf(measured: RubyAndBase): Side {
  const { ruby, base } = measured;
  const dx = (ruby.left + ruby.right) / 2 - (base.left + base.right) / 2;
  const dy = (ruby.top + ruby.bottom) / 2 - (base.top + base.bottom) / 2;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

const ROTATION_CASES = [
  { name: '縦書き', file: 'vertical-story.pdf', base: '傘', ruby: 'かさ', side: 'right' },
  { name: '横書き', file: 'horizontal-print.pdf', base: '筒', ruby: 'とう', side: 'top' },
] as const;

for (const { name, file, base, ruby, side } of ROTATION_CASES) {
  test(`${name}の PDF を回したとき、ルビが回したあとの親字の同じ側に付いてくる`, async ({
    page,
    extensionId,
  }) => {
    await openFromFile(page, extensionId, file);
    await expect(rubyLayer(page, 1).locator(`[data-base="${base}"]`)).toHaveText(ruby, {
      timeout: FIRST_RUBY_TIMEOUT_MS,
    });
    const start = CLOCKWISE.indexOf(side);

    for (const turns of [1, 2, 3]) {
      await page.getByRole('button', { name: '右に回す' }).click();
      const expected = CLOCKWISE[(start + turns) % CLOCKWISE.length];

      await expect
        .poll(async () => sideOf(await measureRuby(page, 1, base)), { timeout: 10_000 })
        .toBe(expected);
      await expect(rubyLayer(page, 1).locator(`[data-base="${base}"]`)).toHaveText(ruby);
    }
  });
}

test('回すボタンをキーボードで押したとき、紙面が回る', async ({ page, extensionId }) => {
  await openFromFile(page, extensionId, 'horizontal-print.pdf');
  await expect(rubyLayer(page, 1).locator('[data-base="筒"]')).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });

  await page.getByRole('button', { name: '右に回す' }).focus();
  await page.keyboard.press('Enter');

  await expect(rubyLayer(page, 1)).toHaveAttribute('data-main-rotation', '90');
});
