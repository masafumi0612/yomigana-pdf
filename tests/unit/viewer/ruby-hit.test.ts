import { describe, expect, it } from 'vitest';

import type { Rect } from '@/pdf/types';
import { distanceToBox, pickRuby, type PlacedRuby, placeRubies } from '@/viewer/ruby-hit';
import type { RubyBox } from '@/viewer/ruby-layout';

/** 倍率 2 で回さないときの、600 × 800 のページの変換（pdf.js の viewport.transform） */
const UPRIGHT = { transform: [2, 0, 0, -2, 0, 1600] };
/** 倍率 2 で、x と y を入れかえる変換（回したときと同じく、軸が入れかわる） */
const TURNED = { transform: [0, 2, 2, 0, 0, 0] };

/**
 * テスト用のルビを作る。置き場所は area だけを使う。
 * @param area ルビと親字を合わせて囲む箱（PDF の座標）
 * @param surface 語の書き方
 * @returns ルビ
 */
function rubyBox(area: Rect, surface = '図鑑'): RubyBox {
  return {
    base: '鑑',
    ruby: 'かん',
    isVertical: false,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    baseSize: 10,
    shrink: 1,
    isSerif: false,
    area,
    word: { surface, reading: 'ずかん', isUserFixed: false },
  };
}

/**
 * 画面の上に置いたルビを作る。
 * @param left 左の端
 * @param top 上の端
 * @param surface 語の書き方
 * @returns 画面の上に置いたルビ
 */
function placed(left: number, top: number, surface: string): PlacedRuby {
  return {
    pageNumber: 1,
    box: rubyBox({ x1: 0, y1: 0, x2: 0, y2: 0 }, surface),
    rect: { left, top, width: 20, height: 30 },
  };
}

describe('placeRubies', () => {
  it('回さないとき、ルビの箱を倍率をかけて紙面の左上からずらした画面の箱にする', () => {
    const box = rubyBox({ x1: 60, y1: 700, x2: 70, y2: 715 });

    const [ruby] = placeRubies(3, [box], UPRIGHT, { left: 10, top: 20 });

    expect(ruby).toEqual({
      pageNumber: 3,
      box,
      rect: { left: 130, top: 190, width: 20, height: 30 },
    });
  });

  it('軸が入れかわる変換のとき、幅と高さも入れかえた画面の箱にする', () => {
    const box = rubyBox({ x1: 60, y1: 700, x2: 70, y2: 715 });

    const [ruby] = placeRubies(1, [box], TURNED, { left: 0, top: 0 });

    expect(ruby?.rect).toEqual({ left: 1400, top: 120, width: 30, height: 20 });
  });
});

describe('distanceToBox', () => {
  it('点が箱の中のとき、0 になる', () => {
    expect(distanceToBox({ left: 0, top: 0, width: 10, height: 10 }, { x: 5, y: 5 })).toBe(0);
  });

  it('点が箱の斜めの外のとき、いちばん近い角までの距離になる', () => {
    expect(distanceToBox({ left: 0, top: 0, width: 10, height: 10 }, { x: 13, y: 14 })).toBe(5);
  });
});

describe('pickRuby', () => {
  const rubies = [placed(0, 0, '図鑑'), placed(100, 0, '今日')];

  it('点がルビの箱の中のとき、そのルビを選ぶ', () => {
    expect(pickRuby(rubies, { x: 110, y: 10 }, { maxDistance: 0 })?.box.word.surface).toBe('今日');
  });

  it('点がどのルビの箱の外で、離れてよい距離が 0 のとき、選ばない', () => {
    expect(pickRuby(rubies, { x: 50, y: 10 }, { maxDistance: 0 })).toBeUndefined();
  });

  it('離れてよい距離の中にいくつもあるとき、いちばん近いルビを選ぶ', () => {
    expect(pickRuby(rubies, { x: 70, y: 10 }, { maxDistance: 100 })?.box.word.surface).toBe('今日');
  });

  it('箱が重なっているとき、中心が近いほうを選ぶ', () => {
    const overlapping = [placed(0, 0, '図鑑'), placed(10, 0, '今日')];

    expect(pickRuby(overlapping, { x: 12, y: 10 }, { maxDistance: 0 })?.box.word.surface).toBe(
      '図鑑',
    );
  });

  it('探す範囲を決めたとき、範囲と重ならないルビは選ばない', () => {
    const within = { left: 0, top: 0, width: 50, height: 50 };

    expect(
      pickRuby(rubies, { x: 110, y: 10 }, { maxDistance: 1000, within })?.box.word.surface,
    ).toBe('図鑑');
  });
});
