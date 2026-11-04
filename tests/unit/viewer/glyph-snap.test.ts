import { describe, expect, it } from 'vitest';

import type { Glyph, Rect } from '@/pdf/types';
import { type DrawnBox, type DrawnGlyph, snapGlyphs, toDrawnBoxes } from '@/viewer/glyph-snap';
import type { Matrix } from '@/viewer/transform';

import { blockOf, rowGlyphs, SIZE } from './make-glyphs';

/** Canvas の画素（y が下向き、高さ 100）から PDF の座標への変換 */
const CANVAS_TO_PDF: Matrix = [1, 0, 0, -1, 0, 100];

/**
 * 横書きの字を描いたときの箱を作る（PDF の座標）。
 * @param left 左の端
 * @param width 送り幅
 * @param bottom 箱の下の端
 * @param size 字の大きさ
 * @returns 描いた字の箱
 */
function drawnBox(left: number, width: number, bottom: number, size = SIZE): DrawnBox {
  return { rect: { x1: left, x2: left + width, y1: bottom, y2: bottom + size }, size };
}

/**
 * 字の箱を引く。
 * @param snapped 合わせた結果
 * @param glyph 字
 * @returns 合わせた箱
 */
function rectOf(snapped: ReadonlyMap<Glyph, Rect>, glyph: Glyph | undefined): Rect | undefined {
  return glyph === undefined ? undefined : snapped.get(glyph);
}

describe('toDrawnBoxes', () => {
  it('描いた字のとき、基準線から下に 0.12 字、上に 0.88 字の箱になる', () => {
    const draw: DrawnGlyph = {
      origin: { x: 10, y: 50 },
      advance: { x: 20, y: 50 },
      top: { x: 10, y: 40 },
    };

    const [box] = toDrawnBoxes([draw], CANVAS_TO_PDF);

    expect(box?.size).toBeCloseTo(10);
    expect(box?.rect.x1).toBeCloseTo(10);
    expect(box?.rect.x2).toBeCloseTo(20);
    expect(box?.rect.y1).toBeCloseTo(48.8);
    expect(box?.rect.y2).toBeCloseTo(58.8);
  });

  it('大きさのない字のとき、除く', () => {
    const point = { x: 1, y: 1 };

    expect(toDrawnBoxes([{ origin: point, advance: point, top: point }], CANVAS_TO_PDF)).toEqual(
      [],
    );
  });
});

describe('snapGlyphs', () => {
  // 「令和8年」の片を等分すると、半角の 8 の後ろの「年」が、本当の位置より左にずれる
  const glyphs = rowGlyphs('令和8年', 0, 0, 8.75);
  const drawn = [drawnBox(0, 10, 0), drawnBox(10, 10, 0), drawnBox(20, 5, 0), drawnBox(25, 10, 0)];

  it('行の描いた字の数が合うとき、読む順に組にする', () => {
    const snapped = snapGlyphs([blockOf(glyphs, 'horizontal')], drawn);

    expect(rectOf(snapped, glyphs[3])).toEqual(drawn[3]?.rect);
  });

  it('行の描いた字が余分にあるとき、近いものと組にする', () => {
    const extra = drawnBox(19, 1, 0);

    const snapped = snapGlyphs([blockOf(glyphs, 'horizontal')], [...drawn, extra]);

    expect(rectOf(snapped, glyphs[3])).toEqual(drawn[3]?.rect);
  });

  it('大きさがかなり違うとき、組にしない', () => {
    const small = rowGlyphs('令', 0, 0, 4);

    const snapped = snapGlyphs([blockOf(small, 'horizontal')], [drawnBox(0, 10, 0)]);

    expect(snapped.size).toBe(0);
  });

  it('別の行の帯にある描いた字とは、組にしない', () => {
    const snapped = snapGlyphs([blockOf(glyphs, 'horizontal')], [drawnBox(0, 10, 30)]);

    expect(snapped.size).toBe(0);
  });
});
