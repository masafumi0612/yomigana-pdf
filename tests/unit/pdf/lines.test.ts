import { describe, expect, it } from 'vitest';

import { toRuns } from '@/pdf/glyphs';
import { buildLines } from '@/pdf/lines';
import type { PdfTextItem } from '@/pdf/types';

import { contentOf, horizontalItem, SIZE, verticalItem } from './make-items';

/**
 * 片を行にまとめ、行ごとの向きと文字にする。行の順は決まっていないので、文字の順に並べる。
 * @param items 片
 * @returns 行ごとの向きの頭文字（v・h）と文字
 */
function linesOf(items: readonly PdfTextItem[]): string[] {
  return buildLines(toRuns(contentOf(items)))
    .map((line) => `${line.direction[0] ?? ''}:${line.glyphs.map((glyph) => glyph.ch).join('')}`)
    .toSorted();
}

describe('buildLines', () => {
  it('同じ列の縦書きの片が続くとき、上から1つの列になる', () => {
    const items = [verticalItem('は雨', 100, 480), verticalItem('今日', 100, 500)];
    expect(linesOf(items)).toEqual(['v:今日は雨']);
  });

  it('同じ列でも上下に2字より離れた片のとき、別の列になる', () => {
    const items = [verticalItem('今日', 100, 500), verticalItem('明日', 100, 450)];
    expect(linesOf(items)).toEqual(['v:今日', 'v:明日']);
  });

  it('列の中心にある短い横書きの片のとき、縦中横として列の一部になる', () => {
    const items = [
      verticalItem('今日は', 100, 500),
      horizontalItem('12', 90, 470 - SIZE * 0.88),
      verticalItem('月', 100, 460),
    ];
    expect(linesOf(items)).toEqual(['v:今日は12月']);
  });

  it('列の中心にあっても4字以上の横書きの片のとき、列に入れない', () => {
    const items = [verticalItem('今日は', 100, 500), horizontalItem('2026', 80, 461.2)];
    expect(linesOf(items)).toEqual(['h:2026', 'v:今日は']);
  });

  it('同じ高さの横書きの片が近くに並ぶとき、左から1つの行になる', () => {
    const items = [horizontalItem('星「地', 140, 500), horizontalItem('私たちの', 100, 500)];
    expect(linesOf(items)).toEqual(['h:私たちの星「地']);
  });

  it('同じ高さでも左右に離れた片のとき、別の行になる', () => {
    const items = [horizontalItem('名前', 100, 500), horizontalItem('日付', 300, 500)];
    expect(linesOf(items)).toEqual(['h:名前', 'h:日付']);
  });

  it('同じ高さでも大きさがとても違う片のとき、別の行になる', () => {
    const items = [horizontalItem('見出し', 100, 500, SIZE * 2), horizontalItem('注', 160, 500)];
    expect(linesOf(items)).toEqual(['h:注', 'h:見出し']);
  });

  it('大きさのはっきり違う片が、少し離れて同じ高さに並ぶとき（本文と横の注の列）、別の行になる', () => {
    const items = [horizontalItem('本文', 100, 500), horizontalItem('注', 128, 500, 7)];
    expect(linesOf(items)).toEqual(['h:本文', 'h:注']);
  });

  it('大きさのはっきり違う片でも、接して並ぶとき、1つの行になる', () => {
    const items = [horizontalItem('本文', 100, 500), horizontalItem('注', 120, 500, 7)];
    expect(linesOf(items)).toEqual(['h:本文注']);
  });
});
