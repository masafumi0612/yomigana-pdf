import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadingResult } from '@/messaging/messages';
import { DEFAULT_SETTINGS } from '@/settings/model';
import type { DrawRecorder } from '@/viewer/draw-recorder';
import type { DrawnGlyph } from '@/viewer/glyph-snap';
import { createPageLayouts, type DrawablePdfPage } from '@/viewer/page-layout';
import type { UserDictionaryFeed } from '@/viewer/user-dictionary-feed';

import { contentOf, defined, horizontalItem } from '../pdf/make-items';

/** 字の大きさ */
const SIZE = 10;
/** 行の左の端と基準線（PDF の座標） */
const LEFT = 100;
const BASELINE = 700;
/** ページの高さ（PDF の座標） */
const PAGE_HEIGHT = 800;
/** 画面に出していないページを描く倍率（page-layout.ts と同じ） */
const SCALE = 0.5;
/** 描いた字が getTextContent() の位置からずれている長さ（PDF の座標） */
const SHIFT = 2;

/** 「今日」の1行 */
const CONTENT = contentOf([horizontalItem('今日', LEFT, BASELINE, SIZE)]);

/** 「今日」に「きょう」を付ける読み */
const READING: ReadingResult = {
  ok: true,
  value: [
    [
      {
        start: 0,
        end: 2,
        ruby: 'きょう',
        isAlways: false,
        word: { surface: '今日', reading: 'きょう', isUserFixed: false },
      },
    ],
  ],
};

/** 直した読みのない、見張らないもの */
const NO_DICTIONARY: UserDictionaryFeed = {
  load: () => Promise.resolve(new Map()),
  watch: () => () => undefined,
};

/**
 * 倍率 0.5 の Canvas に、「今日」の2字を右へ SHIFT だけずらして描いたときの字（Canvas の画素）を作る。
 * @returns 描いた字
 */
function shiftedDraws(): DrawnGlyph[] {
  const toCanvas = (x: number, y: number): DrawnGlyph['origin'] => ({
    x: x * SCALE,
    y: (PAGE_HEIGHT - y) * SCALE,
  });
  return [0, 1].map((index) => {
    const x = LEFT + SHIFT + index * SIZE;
    return {
      origin: toCanvas(x, BASELINE),
      advance: toCanvas(x + SIZE, BASELINE),
      top: toCanvas(x, BASELINE + SIZE),
    };
  });
}

/** 読みを出せなかったときの答え */
const FAILED: ReadingResult = { ok: false, error: 'no-response' };

/**
 * 画面に出していないページを読む部品を作る。
 * @param draws ページを描いたときに書き留める字
 * @param reading 読みの問い合わせの答え
 * @returns 部品と、ページを描いた回数・読みを出せなかったページの知らせを数えるもの
 */
function setUp(
  draws: readonly DrawnGlyph[],
  reading: ReadingResult = READING,
): {
  layouts: ReturnType<typeof createPageLayouts>;
  render: ReturnType<typeof vi.fn>;
  onReadingFailureChange: ReturnType<typeof vi.fn>;
  page: DrawablePdfPage;
} {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  // 使うところだけを持つ、ページのにせもの
  const page = {
    view: [0, 0, 600, PAGE_HEIGHT],
    getTextContent: () => Promise.resolve(CONTENT),
    commonObjs: { has: () => false, get: () => undefined },
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: PAGE_HEIGHT * scale,
      transform: [scale, 0, 0, -scale, 0, PAGE_HEIGHT * scale],
    }),
    render,
  } as unknown as DrawablePdfPage;
  const recorder: DrawRecorder = { watch: () => undefined, take: () => [...draws] };
  const onReadingFailureChange = vi.fn();
  const layouts = createPageLayouts({
    getPage: () => Promise.resolve(page),
    recorder,
    settings: { ...DEFAULT_SETTINGS, level: 'all' },
    readTexts: () => Promise.resolve(reading),
    userDictionary: NO_DICTIONARY,
    onReadingFailureChange,
  });
  return { layouts, render, onReadingFailureChange, page };
}

describe('createPageLayouts の layoutPage', () => {
  beforeEach(() => {
    // 描く Canvas のにせもの（単体テストには DOM がない）
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0 }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('画面に出していないページのとき、倍率 0.5 で描いた字の位置に合わせてルビを置く', async () => {
    const drawn = defined((await setUp(shiftedDraws()).layouts.layoutPage(1))?.[0]);
    const plain = defined((await setUp([]).layouts.layoutPage(1))?.[0]);

    expect(drawn.left - plain.left).toBeCloseTo(SHIFT);
  });

  it('置き場所を出したページのとき、もう一度は描かずに取っておいた置き場所を返す', async () => {
    const { layouts, render } = setUp(shiftedDraws());
    const first = await layouts.layoutPage(1);

    const second = await layouts.layoutPage(1);

    expect([render.mock.calls.length, second]).toEqual([1, first]);
  });

  it('画面に出していないページで読みを出せなかったとき、置き場所は undefined になる', async () => {
    expect(await setUp([], FAILED).layouts.layoutPage(1)).toBeUndefined();
  });

  it('画面に出していないページで読みを出せなかったとき、画面の「もう一度」に入れない', async () => {
    const { layouts, onReadingFailureChange } = setUp([], FAILED);

    await layouts.layoutPage(1);

    expect([layouts.failedPages(), onReadingFailureChange.mock.calls]).toEqual([[], []]);
  });

  it('画面に重ねる側が用意を頼んだページで読みを出せなかったとき、画面の「もう一度」に入れる', async () => {
    const { layouts, onReadingFailureChange, page } = setUp([], FAILED);

    await layouts.prepare(1, page);

    expect([layouts.failedPages(), onReadingFailureChange.mock.calls]).toEqual([[1], [[true]]]);
  });
});
