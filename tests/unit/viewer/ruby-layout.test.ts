import { describe, expect, it } from 'vitest';

import type { Glyph, Rect } from '@/pdf/types';
import type { RubySpan } from '@/text/annotate';
import {
  layoutRubies,
  type PageFrame,
  roomOutside,
  type RubyLayoutOptions,
  splitReading,
  toPageBox,
} from '@/viewer/ruby-layout';

import { blockOf, columnGlyphs, rowGlyphs, SIZE } from './make-glyphs';

/** A4 のページ（PDF の座標） */
const FRAME: PageFrame = { pageX: 0, pageY: 0, pageWidth: 595, pageHeight: 842 };
/** ルビの字の大きさの割合 */
const RATIO = 0.5;
const OPTIONS: RubyLayoutOptions = {
  sizeRatio: RATIO,
  rectOf: (glyph) => glyph.rect,
  isSerif: () => false,
};

/**
 * ルビを付ける所を作る。
 * @param start 頭の位置
 * @param end 終わりの次の位置
 * @param ruby ルビ
 * @returns ルビを付ける所
 */
function span(start: number, end: number, ruby: string): RubySpan {
  return { start, end, ruby, isAlways: false };
}

describe('layoutRubies', () => {
  it('縦書きのとき、ルビを字の右に置く', () => {
    const block = blockOf(columnGlyphs('今日', 100, 500), 'vertical');

    const [box] = layoutRubies([block], [[span(0, 1, 'いま')]], FRAME, OPTIONS);

    expect(box).toMatchObject({ isVertical: true, left: 110, top: 342, width: SIZE * RATIO });
  });

  it('横書きのとき、ルビを字の上に置く', () => {
    const block = blockOf(rowGlyphs('学年', 50, 700), 'horizontal');

    const [box] = layoutRubies([block], [[span(1, 2, 'ねん')]], FRAME, OPTIONS);

    expect(box).toMatchObject({ isVertical: false, left: 60, top: 842 - 715, height: 5 });
  });

  it('ルビが親字より長いとき、親字の中心から両側にはみ出す', () => {
    const block = blockOf(rowGlyphs('承', 50, 700), 'horizontal');

    const [box] = layoutRubies([block], [[span(0, 1, 'うけたまわ')]], FRAME, OPTIONS);

    expect(box).toMatchObject({ left: 55 - 12.5, width: 25 });
  });

  it('親字が明朝のとき、ルビも明朝にする', () => {
    const block = blockOf(rowGlyphs('学年', 50, 700), 'horizontal');
    const options = { ...OPTIONS, isSerif: () => true };

    const [box] = layoutRubies([block], [[span(0, 2, 'がくねん')]], FRAME, options);

    expect(box?.isSerif).toBe(true);
  });

  it('親字の明朝とゴシックが半々のとき、ゴシックにする', () => {
    const block = blockOf(rowGlyphs('学年', 50, 700), 'horizontal');
    const options = { ...OPTIONS, isSerif: (glyph: Glyph) => glyph.ch === '学' };

    const [box] = layoutRubies([block], [[span(0, 2, 'がくねん')]], FRAME, options);

    expect(box?.isSerif).toBe(false);
  });

  it('もとからルビのある字にかかるとき、付けない', () => {
    const [glyph, ...rest] = columnGlyphs('港', 100, 500);
    const withRuby: Glyph[] = glyph === undefined ? [] : [{ ...glyph, hasRuby: true }, ...rest];

    const boxes = layoutRubies(
      [blockOf(withRuby, 'vertical')],
      [[span(0, 1, 'みなと')]],
      FRAME,
      OPTIONS,
    );

    expect(boxes).toEqual([]);
  });

  it('行をまたぐとき、行ごとに分けてルビの文字を字の数で分ける', () => {
    const glyphs = [...columnGlyphs('今', 100, 500), ...columnGlyphs('日', 80, 600)];

    const boxes = layoutRubies(
      [blockOf(glyphs, 'vertical')],
      [[span(0, 2, 'きょう')]],
      FRAME,
      OPTIONS,
    );

    expect(boxes.map((box) => [box.base, box.ruby])).toEqual([
      ['今', 'きょ'],
      ['日', 'う'],
    ]);
  });

  it('隣の列が近いとき、ルビを空いている分まで小さくする', () => {
    const glyphs = [...columnGlyphs('右', 114, 500), ...columnGlyphs('左', 100, 500)];

    const [, box] = layoutRubies(
      [blockOf(glyphs, 'vertical')],
      [[span(0, 1, 'みぎ'), span(1, 2, 'ひだり')]],
      FRAME,
      OPTIONS,
    );

    expect(box?.shrink).toBeCloseTo(0.8);
  });

  it('描いた位置の箱が分かるとき、その箱に合わせる', () => {
    const block = blockOf(rowGlyphs('年', 50, 700), 'horizontal');
    const exact: Rect = { x1: 70, x2: 80, y1: 700, y2: 710 };

    const [box] = layoutRubies([block], [[span(0, 1, 'ねん')]], FRAME, {
      ...OPTIONS,
      rectOf: () => exact,
    });

    expect(box?.left).toBe(70);
  });
});

describe('roomOutside', () => {
  const base: Rect = { x1: 100, x2: 110, y1: 490, y2: 500 };

  it('隣の列がないとき、限りなく空いている', () => {
    expect(roomOutside(base, 10, true, SIZE, [base])).toBe(Infinity);
  });

  it('隣の列がとても近いとき、空きは 0 になる', () => {
    const close: Rect = { x1: 109, x2: 119, y1: 490, y2: 500 };

    expect(roomOutside(base, 10, true, SIZE, [close])).toBe(0);
  });

  it('隣の列がルビの長さの外にあるとき、数えない', () => {
    const far: Rect = { x1: 112, x2: 122, y1: 400, y2: 410 };

    expect(roomOutside(base, 10, true, SIZE, [far])).toBe(Infinity);
  });
});

describe('splitReading', () => {
  it('字の数が同じ2つに分けるとき、ルビの文字をおよそ半分ずつにする', () => {
    expect(splitReading('きょう', [1, 1])).toEqual(['きょ', 'う']);
  });

  it('1つだけのとき、ルビの文字をそのまま返す', () => {
    expect(splitReading('はくぶつかん', [3])).toEqual(['はくぶつかん']);
  });
});

describe('toPageBox', () => {
  it('ページの箱がずれているとき、ページの左上からの長さにする', () => {
    const frame: PageFrame = { pageX: 10, pageY: 20, pageWidth: 100, pageHeight: 200 };

    expect(toPageBox({ x1: 30, x2: 40, y1: 150, y2: 160 }, frame)).toEqual({
      left: 20,
      top: 60,
      width: 10,
      height: 10,
    });
  });
});
