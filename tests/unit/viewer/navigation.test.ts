import { describe, expect, it } from 'vitest';

import { formatZoom, nextZoomStep, parsePageNumber } from '@/viewer/navigation';

describe('parsePageNumber', () => {
  it('範囲の中の数のとき、そのページ番号になる', () => {
    expect(parsePageNumber(' 3 ', 5)).toEqual({ ok: true, value: 3 });
  });

  it('全角の数字のとき、半角に直して読む', () => {
    expect(parsePageNumber('１２', 20)).toEqual({ ok: true, value: 12 });
  });

  it('数でないとき、失敗になる', () => {
    expect(parsePageNumber('2a', 5)).toEqual({ ok: false, error: 'not-a-number' });
  });

  it('小数のとき、失敗になる', () => {
    expect(parsePageNumber('1.5', 5)).toEqual({ ok: false, error: 'not-a-number' });
  });

  it('0 のとき、範囲の外になる', () => {
    expect(parsePageNumber('0', 5)).toEqual({ ok: false, error: 'out-of-range' });
  });

  it('全ページ数より大きいとき、範囲の外になる', () => {
    expect(parsePageNumber('6', 5)).toEqual({ ok: false, error: 'out-of-range' });
  });
});

describe('nextZoomStep', () => {
  it('段階ちょうどから拡大するとき、1つ上の段階になる', () => {
    expect(nextZoomStep(1, 'in')).toBe(1.1);
  });

  it('段階の間から縮小するとき、すぐ下の段階になる', () => {
    expect(nextZoomStep(1.37, 'out')).toBe(1.25);
  });

  it('段階とごくわずかに違うとき、その段階を飛ばす', () => {
    expect(nextZoomStep(0.9999, 'in')).toBe(1.1);
  });

  it('いちばん大きい段階から拡大するとき、いちばん大きい段階のままになる', () => {
    expect(nextZoomStep(5, 'in')).toBe(5);
  });

  it('いちばん小さい段階から縮小するとき、いちばん小さい段階のままになる', () => {
    expect(nextZoomStep(0.25, 'out')).toBe(0.25);
  });
});

describe('formatZoom', () => {
  it('倍率のとき、四捨五入した百分率になる', () => {
    expect(formatZoom(1.234)).toBe('123%');
  });
});
