import { describe, expect, it } from 'vitest';

import {
  alongOffsets,
  type GlyphAdvance,
  type GlyphBox,
  lineBaseline,
  placeGlyphs,
} from '@/pdf-export/glyph-placement';

/** 字の大きさ */
const SIZE = 10;
/** 1字の送り（縦横とも1字） */
const FULL: GlyphAdvance = { horizontal: 1, vertical: 1 };
/** 横の送りが半分の字 */
const HALF: GlyphAdvance = { horizontal: 0.5, vertical: 1 };
/** 基準の位置（横書きの基準線は行の上から 0.9 字、縦書きの原点は字の枠の上から 0.88 字） */
const FRAME = { baseline: 0.9, verticalOrigin: 0.88 };

/**
 * 箱を作る。
 * @param overrides 変える所
 * @returns 箱
 */
function boxOf(overrides: Partial<GlyphBox>): GlyphBox {
  return {
    isVertical: false,
    isSpread: false,
    left: 100,
    top: 50,
    width: 40,
    height: SIZE,
    fontSize: SIZE,
    ...overrides,
  };
}

describe('alongOffsets', () => {
  it('均等でないとき、字をまとめて箱の真ん中に置く（justify-content: center）', () => {
    expect(alongOffsets([10, 10], 40, false)).toEqual([10, 20]);
  });

  it('均等のとき、空きを字の数で分け、両端には半分ずつ置く（space-around）', () => {
    expect(alongOffsets([10, 10], 40, true)).toEqual([5, 25]);
  });

  it('均等で字が1つのとき、真ん中に置く', () => {
    expect(alongOffsets([10], 40, true)).toEqual([15]);
  });

  it('箱からはみ出すとき、均等でも両側へ等しくはみ出す', () => {
    expect(alongOffsets([10, 10, 10], 20, true)).toEqual([-5, 5, 15]);
  });

  it('送りの違う字のとき、それぞれの送りの分だけ進める', () => {
    expect(alongOffsets([10, 5, 10], 40, false)).toEqual([7.5, 17.5, 22.5]);
  });
});

describe('lineBaseline', () => {
  it('字の上下の高さが1字のとき、上の高さの所が基準線になる', () => {
    expect(lineBaseline(0.88, 0.12)).toBeCloseTo(0.88);
  });

  it('字の上下の高さが1字より大きいとき、はみ出た分を上下に等しく分ける', () => {
    expect(lineBaseline(1.16, 0.32)).toBeCloseTo(0.92);
  });
});

describe('placeGlyphs', () => {
  it('横書きのとき、字の原点を箱の左からの並びに、基準線を行の上から frame.baseline 字の所に置く', () => {
    expect(placeGlyphs(boxOf({}), [FULL, FULL], FRAME)).toEqual([
      { x: 110, y: 59 },
      { x: 120, y: 59 },
    ]);
  });

  it('横書きで箱の高さが字より大きいとき、行を箱の高さの真ん中に置く', () => {
    const [first] = placeGlyphs(boxOf({ height: 14 }), [FULL], FRAME);

    expect(first?.y).toBeCloseTo(50 + 2 + 9);
  });

  it('横書きで横の送りの違う字のとき、送りの分だけ並べる', () => {
    expect(placeGlyphs(boxOf({}), [FULL, HALF], FRAME).map(({ x }) => x)).toEqual([112.5, 122.5]);
  });

  it('縦書きのとき、字を上から並べ、字の枠の上から frame.verticalOrigin 字の所を原点にする', () => {
    const box = boxOf({ isVertical: true, width: SIZE, height: 40 });

    expect(placeGlyphs(box, [FULL, FULL], FRAME).map(({ y }) => y)).toEqual([
      50 + 10 + 8.8,
      50 + 20 + 8.8,
    ]);
  });

  it('縦書きのとき、字の横の送りの真ん中を列の真ん中に合わせる', () => {
    const box = boxOf({ isVertical: true, width: 12, height: 40 });

    expect(placeGlyphs(box, [FULL, HALF], FRAME).map(({ x }) => x)).toEqual([101, 103.5]);
  });

  it('縦書きで均等のとき、縦の送りで空きを分ける', () => {
    const box = boxOf({ isVertical: true, isSpread: true, width: SIZE, height: 40 });

    expect(placeGlyphs(box, [HALF, HALF], FRAME).map(({ y }) => y)).toEqual([
      50 + 5 + 8.8,
      50 + 25 + 8.8,
    ]);
  });
});
