import { describe, expect, it } from 'vitest';

import {
  applyMatrix,
  invertMatrix,
  type Matrix,
  multiplyMatrix,
  toMatrix,
  transformBox,
} from '@/viewer/transform';

/** pdf.js の 100% のときの viewport.transform（高さ 842 のページ。y を下向きにする） */
const PAGE_TO_SCREEN: Matrix = [1, 0, 0, -1, 0, 842];

describe('applyMatrix', () => {
  it('ページの変換をかけたとき、y が上下に返る', () => {
    expect(applyMatrix(PAGE_TO_SCREEN, { x: 10, y: 800 })).toEqual({ x: 10, y: 42 });
  });
});

describe('multiplyMatrix', () => {
  it('2倍のあとにページの変換をかけたとき、点が順にかけた位置になる', () => {
    const scaled = multiplyMatrix([2, 0, 0, 2, 0, 0], PAGE_TO_SCREEN);

    expect(applyMatrix(scaled, { x: 10, y: 800 })).toEqual({ x: 20, y: 84 });
  });
});

describe('invertMatrix', () => {
  it('回した変換の逆をかけたとき、もとの点に戻る', () => {
    const rotated: Matrix = [0, 1, -1, 0, 30, 5];
    const inverse = invertMatrix(rotated);

    expect(inverse).toBeDefined();
    const back = applyMatrix(inverse ?? rotated, applyMatrix(rotated, { x: 3, y: 4 }));
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(4);
  });

  it('つぶれた変換のとき、undefined になる', () => {
    expect(invertMatrix([0, 0, 0, 0, 1, 1])).toBeUndefined();
  });
});

describe('toMatrix', () => {
  it('数が足りないとき、足りないところは単位行列の値になる', () => {
    expect(toMatrix([2, 0])).toEqual([2, 0, 0, 1, 0, 0]);
  });
});

describe('transformBox', () => {
  it('ページの変換をかけたとき、上の端が画面の上になる箱になる', () => {
    expect(transformBox(PAGE_TO_SCREEN, { x1: 10, y1: 700, x2: 50, y2: 800 })).toEqual({
      left: 10,
      top: 42,
      width: 40,
      height: 100,
    });
  });

  it('90 度回した変換をかけたとき、幅と高さが入れかわった箱になる', () => {
    // 右に 90 度回した、100% のときの viewport.transform（ページの箱が原点から始まるとき）
    const rotated: Matrix = [0, 1, 1, 0, 0, 0];

    expect(transformBox(rotated, { x1: 10, y1: 700, x2: 50, y2: 800 })).toEqual({
      left: 700,
      top: 10,
      width: 100,
      height: 40,
    });
  });
});
