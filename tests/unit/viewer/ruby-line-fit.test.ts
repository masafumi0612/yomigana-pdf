import { describe, expect, it } from 'vitest';

import { fitLine, type LineFit, type LineRuby, MAX_SHIFT_EM } from '@/viewer/ruby-line-fit';

/** 親字の大きさ */
const SIZE = 10;

/**
 * 1字の親字のルビを作る。
 * @param start 親字の頭の端
 * @param charCount ルビの字の数
 * @returns ルビ
 */
function ruby(start: number, charCount: number): LineRuby {
  return {
    baseStart: start,
    baseEnd: start + SIZE,
    baseSize: SIZE,
    charCount,
    fontSize: SIZE / 2,
    isSpread: false,
  };
}

/**
 * 隣どうしの箱が重ならないか。
 * @param fits 置き直したルビ（読む順）
 * @returns 重ならなければ true
 */
function isSeparated(fits: readonly LineFit[]): boolean {
  return fits.every((fit, index) => {
    const next = fits[index + 1];
    return next === undefined || fit.end <= next.start + 1e-9;
  });
}

describe('fitLine', () => {
  it('ぶつからないルビは、親字の中心のまま、縮めない', () => {
    expect(fitLine([ruby(0, 2), ruby(100, 4)])).toEqual([
      { scale: 1, start: 0, end: 10 },
      { scale: 1, start: 95, end: 115 },
    ]);
  });

  it('離れた所のルビが入らないとき、そのまとまりだけ縮める', () => {
    const fits = fitLine([ruby(0, 2), ruby(100, 8), ruby(110, 8)]);

    expect(fits[0]?.scale).toBe(1);
    expect(fits[1]?.scale).toBeLessThan(1);
    expect(isSeparated(fits)).toBe(true);
  });

  it('縮めて入るとき、ずらすのは親字の大きさの半分まで', () => {
    const fits = fitLine([ruby(0, 8), ruby(10, 8)]);

    expect(isSeparated(fits)).toBe(true);
    expect(
      fits.every((fit, index) => {
        const middle = index * SIZE + SIZE / 2;
        return Math.abs((fit.start + fit.end) / 2 - middle) <= SIZE * MAX_SHIFT_EM + 1e-6;
      }),
    ).toBe(true);
  });

  it('親字が同じ所に重なっていても、ルビの箱は重ならない', () => {
    expect(isSeparated(fitLine([ruby(0, 4), ruby(0, 4), ruby(0, 4)]))).toBe(true);
  });

  it('箱を広げるとき、隣の字との間の真ん中を越えない', () => {
    // 2つ目は字が親字より短いが、箱は親字の長さまで広げたい。前のルビのはみ出しに当たる所で止める
    const fits = fitLine([ruby(0, 3), ruby(10, 1)]);

    expect(fits[1]).toEqual({ scale: 1, start: 12.5, end: 17.5 });
  });
});
