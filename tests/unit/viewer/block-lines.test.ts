import { describe, expect, it } from 'vitest';

import { splitLines } from '@/viewer/block-lines';

import { columnGlyphs, rowGlyphs, SIZE } from './make-glyphs';

describe('splitLines', () => {
  it('縦書きで次の列へ移ったとき、そこで行を分ける', () => {
    const glyphs = [...columnGlyphs('今日は', 100, 500), ...columnGlyphs('晴れ', 80, 500)];

    expect(splitLines(glyphs, 'vertical')).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
  });

  it('横書きで次の行へ移ったとき、そこで行を分ける', () => {
    const glyphs = [...rowGlyphs('学年', 0, 500), ...rowGlyphs('だより', 0, 480)];

    expect(splitLines(glyphs, 'horizontal')).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it('縦書きの列の中に縦中横の数字が半字ずつ並ぶとき、行を分けない', () => {
    const [ichi, ni] = rowGlyphs('12', 100, 490 - SIZE / 2, SIZE / 2);
    const glyphs = [
      ...columnGlyphs('今', 100, 500),
      ...(ichi === undefined || ni === undefined ? [] : [ichi, ni]),
      ...columnGlyphs('月', 100, 485),
    ];

    expect(splitLines(glyphs, 'vertical')).toEqual([[0, 1, 2, 3]]);
  });

  it('字がないとき、空になる', () => {
    expect(splitLines([], 'horizontal')).toEqual([]);
  });
});
