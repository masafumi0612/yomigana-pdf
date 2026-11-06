import { describe, expect, it } from 'vitest';

import type { Glyph, Rect } from '@/pdf/types';
import type { RubySpan, RubyWord } from '@/text/annotate';
import {
  layoutRubies,
  type PageFrame,
  roomOutside,
  type RubyBox,
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

/** ルビのもとになった語（置き場所には使わない） */
const WORD = { surface: '今日', reading: 'きょう', isUserFixed: false };

/**
 * ルビを付ける所を作る。
 * @param start 頭の位置
 * @param end 終わりの次の位置
 * @param ruby ルビ
 * @returns ルビを付ける所
 */
function span(start: number, end: number, ruby: string): RubySpan {
  return { start, end, ruby, isAlways: false, word: WORD };
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

  it('ルビを置いたとき、ルビと親字を合わせて囲む箱を PDF の座標で持つ', () => {
    const block = blockOf(rowGlyphs('学年', 50, 700), 'horizontal');

    const [box] = layoutRubies([block], [[span(1, 2, 'ねん')]], FRAME, OPTIONS);

    expect(box?.area).toEqual({ x1: 60, y1: 700, x2: 70, y2: 715 });
  });

  it('ルビを置いたとき、ルビのもとになった語を持つ', () => {
    const block = blockOf(rowGlyphs('学年', 50, 700), 'horizontal');

    const [box] = layoutRubies([block], [[span(1, 2, 'ねん')]], FRAME, OPTIONS);

    expect(box?.word).toBe(WORD);
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

/**
 * ルビのもとになった語を作る。別の語は別の物にする。
 * @param surface 語の書き方
 * @returns 語
 */
function wordOf(surface: string): RubyWord {
  return { surface, reading: '', isUserFixed: false };
}

/**
 * 語のルビを付ける所を作る。
 * @param start 頭の位置
 * @param end 終わりの次の位置
 * @param ruby ルビ
 * @param word ルビのもとになった語
 * @returns ルビを付ける所
 */
function wordSpan(start: number, end: number, ruby: string, word: RubyWord): RubySpan {
  return { start, end, ruby, isAlways: false, word };
}

/** 行の向きの、箱の頭と終わり（読む向きに進むほど大きい） */
function along(box: RubyBox): { start: number; end: number } {
  return box.isVertical
    ? { start: box.top, end: box.top + box.height }
    : { start: box.left, end: box.left + box.width };
}

/**
 * 同じ行のルビの箱のうち、重なる組があるか。
 * @param boxes 同じ行のルビ
 * @returns 重なる組があれば true
 */
function hasOverlap(boxes: readonly RubyBox[]): boolean {
  return boxes.some((a, i) =>
    boxes.some((b, j) => {
      if (i >= j) return false;
      const p = along(a);
      const q = along(b);
      return Math.min(p.end, q.end) - Math.max(p.start, q.start) > 1e-6;
    }),
  );
}

/**
 * ルビの箱の中心の、親字の中心からのずれ。
 * @param box ルビ
 * @param baseStart 親字の頭の端（行の向き。縦書きはページの上からの長さ）
 * @param baseLength 親字の長さ
 * @returns ずれの大きさ
 */
function shiftOf(box: RubyBox, baseStart: number, baseLength: number): number {
  const { start, end } = along(box);
  return Math.abs((start + end) / 2 - (baseStart + baseLength / 2));
}

/** 縦書き・横書きの行を作る。どちらも親字の頭の端（行の向き）が 100 になる */
const DIRECTIONS = [
  {
    name: '縦書き',
    block: (text: string) => blockOf(columnGlyphs(text, 300, FRAME.pageHeight - 100), 'vertical'),
    thickness: (box: RubyBox) => box.width,
  },
  {
    name: '横書き',
    block: (text: string) => blockOf(rowGlyphs(text, 100, 400), 'horizontal'),
    thickness: (box: RubyBox) => box.height,
  },
] as const;

for (const { name, block, thickness } of DIRECTIONS) {
  describe(`layoutRubies 同じ行の隣のルビ（${name}）`, () => {
    it('別の語の、親字より長いルビが隣り合うとき、同じ行のどの2つの箱も重ならない', () => {
      const [west, teacher] = [wordOf('西'), wordOf('先生')];
      const spans = [
        wordSpan(0, 1, 'にしにし', west),
        wordSpan(1, 2, 'せんせん', teacher),
        wordSpan(2, 3, 'せいせい', teacher),
      ];

      const boxes = layoutRubies([block('西先生')], [spans], FRAME, OPTIONS);

      expect(hasOverlap(boxes)).toBe(false);
    });

    it('ずらせば入るとき、字を縮めずに、親字の大きさの半分までずらして避ける', () => {
      const spans = [
        wordSpan(0, 1, 'にしに', wordOf('西')),
        wordSpan(1, 2, 'せんせ', wordOf('先')),
      ];

      const boxes = layoutRubies([block('西先')], [spans], FRAME, OPTIONS);

      expect(hasOverlap(boxes)).toBe(false);
      expect(boxes.map((box) => box.shrink)).toEqual([1, 1]);
      expect(boxes.map((box, index) => shiftOf(box, 100 + index * SIZE, SIZE))).toEqual([2.5, 2.5]);
    });

    it('ずらしても入らないとき、字を小さくして、親字から半分より離さない', () => {
      const spans = Array.from('一二三', (ch, index) =>
        wordSpan(index, index + 1, 'ああああああ', wordOf(ch)),
      );

      const boxes = layoutRubies([block('一二三')], [spans], FRAME, OPTIONS);

      expect(hasOverlap(boxes)).toBe(false);
      expect(boxes.every((box) => box.shrink < 1)).toBe(true);
      expect(
        boxes.every((box, index) => shiftOf(box, 100 + index * SIZE, SIZE) <= SIZE / 2 + 1e-6),
      ).toBe(true);
    });

    it('字を小さくしたとき、字の大きさと箱の太さが合い、字が箱の長さに収まる', () => {
      const spans = Array.from('一二三', (ch, index) =>
        wordSpan(index, index + 1, 'ああああああ', wordOf(ch)),
      );

      const boxes = layoutRubies([block('一二三')], [spans], FRAME, OPTIONS);

      for (const box of boxes) {
        expect(box.fontSize).toBeCloseTo(SIZE * RATIO * box.shrink);
        expect(thickness(box)).toBeCloseTo(box.fontSize);
        const { start, end } = along(box);
        expect(end - start).toBeGreaterThanOrEqual(6 * box.fontSize - 1e-6);
      }
    });

    it('隣の字にルビがないとき、今までと同じく親字の中心から両側にはみ出す', () => {
      const [box] = layoutRubies([block('承る')], [[span(0, 1, 'うけたまわ')]], FRAME, OPTIONS);

      expect(box?.shrink).toBe(1);
      expect(box === undefined ? undefined : along(box)).toEqual({
        start: 100 + 5 - 12.5,
        end: 100 + 5 + 12.5,
      });
    });

    it('同じ語の隣り合う字のルビが重なるとき、まとめて合わせた親字の中心に置く', () => {
      const school = wordOf('小学');
      const spans = [wordSpan(0, 1, 'しょう', school), wordSpan(1, 2, 'がっ', school)];

      const boxes = layoutRubies([block('小学')], [spans], FRAME, OPTIONS);

      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toMatchObject({ base: '小学', ruby: 'しょうがっ', shrink: 1 });
      expect(boxes[0] === undefined ? undefined : along(boxes[0])).toEqual({
        start: 100 + 10 - 12.5,
        end: 100 + 10 + 12.5,
      });
    });

    it('同じ語でも、字ごとのルビが重ならないとき、まとめずに字ごとに置く', () => {
      const grade = wordOf('学年');
      const spans = [wordSpan(0, 1, 'がく', grade), wordSpan(1, 2, 'ねん', grade)];

      const boxes = layoutRubies([block('学年')], [spans], FRAME, OPTIONS);

      expect(boxes.map((box) => [box.base, box.ruby, box.isSpread])).toEqual([
        ['学', 'がく', false],
        ['年', 'ねん', false],
      ]);
    });

    it('別の語どうしのルビが重なるとき、まとめない', () => {
      const spans = [
        wordSpan(0, 1, 'にしに', wordOf('西')),
        wordSpan(1, 2, 'せんせ', wordOf('先')),
      ];

      const boxes = layoutRubies([block('西先')], [spans], FRAME, OPTIONS);

      expect(boxes.map((box) => box.base)).toEqual(['西', '先']);
    });
  });
}

describe('layoutRubies 熟語のルビ', () => {
  it('まとめた字が合わせた親字より短いとき、親字の長さに均等に並べる', () => {
    // 字の送りが字の大きさより狭い PDF（親字の箱が少し重なる）
    const glyphs = [...rowGlyphs('学', 50, 700), ...rowGlyphs('校', 58, 700)];
    const school = wordOf('学校');
    const spans = [wordSpan(0, 1, 'がっ', school), wordSpan(1, 2, 'こう', school)];

    const [box, ...rest] = layoutRubies([blockOf(glyphs, 'horizontal')], [spans], FRAME, {
      ...OPTIONS,
      sizeRatio: 0.45,
    });

    expect(rest).toEqual([]);
    expect(box).toMatchObject({ base: '学校', ruby: 'がっこう', isSpread: true, left: 50 });
    expect(box?.width).toBeCloseTo(18);
  });
});
