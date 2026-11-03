import { describe, expect, it } from 'vitest';

import type { PlacedGlyph } from '@/pdf/glyphs';
import { toRuns } from '@/pdf/glyphs';
import { isRubyBase, splitRuby } from '@/pdf/ruby';
import type { PdfTextItem } from '@/pdf/types';

import { contentOf, defined, horizontalItem, unmarkedColumn, verticalItem } from './make-items';

/** 親字の大きさ */
const BASE = 20;
/** ルビの字の大きさ */
const RUBY = 10;

/**
 * 片を本文とルビに分ける。
 * @param items 片
 * @returns 本文のランの文字と、ルビ
 */
function split(items: readonly PdfTextItem[]): ReturnType<typeof splitRuby> {
  return splitRuby(toRuns(contentOf(items)));
}

/**
 * 横書きの親字の上に置く、ルビの基準線。親字の上の端のすぐ上にする。
 * @param baseLine 親字の基準線
 * @returns ルビの基準線
 */
function rubyLineAbove(baseLine: number): number {
  return baseLine + BASE * 0.88 + RUBY * 0.12;
}

describe('splitRuby', () => {
  it('横書きの親字のすぐ上の小さいかなのとき、ルビになる', () => {
    const { body, rubies } = split([
      horizontalItem('地球', 100, 500, BASE),
      horizontalItem('ちきゅう', 100, rubyLineAbove(500), RUBY),
    ]);
    expect(body.map((run) => run.text)).toEqual(['地球']);
    expect(rubies.map((ruby) => [ruby.reading, ruby.baseDirection])).toEqual([
      ['ちきゅう', 'horizontal'],
    ]);
  });

  it('縦書きの親字のすぐ右の小さいかなのとき、ルビになる', () => {
    const { body, rubies } = split([
      verticalItem('港', 100, 500, BASE),
      verticalItem('みなと', 100 + BASE / 2 + RUBY / 2, 505, RUBY),
    ]);
    expect(body.map((run) => run.text)).toEqual(['港']);
    expect(rubies.map((ruby) => [ruby.reading, ruby.baseDirection])).toEqual([
      ['みなと', 'vertical'],
    ]);
  });

  it('となりの字と同じくらいの大きさのかなのとき、ルビにならない', () => {
    const { rubies } = split([
      horizontalItem('地球', 100, 500, BASE),
      horizontalItem('ちきゅう', 100, 520, BASE * 0.7),
    ]);
    expect(rubies).toEqual([]);
  });

  it('小さい字に漢字が混じるとき、ルビにならない', () => {
    const { rubies } = split([
      horizontalItem('地球', 100, 500, BASE),
      horizontalItem('注1', 100, rubyLineAbove(500), RUBY),
    ]);
    expect(rubies).toEqual([]);
  });

  it('小さいかなが親字から離れているとき、ルビにならない', () => {
    const { rubies } = split([
      horizontalItem('地球', 100, 500, BASE),
      horizontalItem('ちきゅう', 100, 560, RUBY),
    ]);
    expect(rubies).toEqual([]);
  });

  it('1字ずつ分かれた横書きのルビのとき、1つのルビにつなぐ', () => {
    const { rubies } = split([
      horizontalItem('空気', 100, 500, BASE),
      horizontalItem('く', 103, rubyLineAbove(500), RUBY),
      horizontalItem('う', 116, rubyLineAbove(500), RUBY),
      horizontalItem('き', 129, rubyLineAbove(500), RUBY),
    ]);
    expect(rubies.map((ruby) => ruby.reading)).toEqual(['くうき']);
  });

  it('縦書きの印のない列の右に1字ずつのルビがあるとき、1つのルビにつなぐ', () => {
    // Word の縦書きは、ルビも1字ずつの片で、親字より字間が広い
    const { body, rubies } = split([
      ...unmarkedColumn('の図鑑を', 100, 500, BASE),
      horizontalItem('ず', 121, 487, RUBY),
      horizontalItem('か', 121, 473.5, RUBY),
      horizontalItem('ん', 121, 460, RUBY),
    ]);
    expect(body.map((run) => run.text)).toEqual(['の図鑑を']);
    expect(rubies.map((ruby) => [ruby.reading, ruby.baseDirection])).toEqual([
      ['ずかん', 'vertical'],
    ]);
  });

  it('離れた語のルビのとき、つながない', () => {
    const { rubies } = split([
      horizontalItem('私の星', 100, 500, BASE),
      horizontalItem('わたし', 95, rubyLineAbove(500), RUBY),
      horizontalItem('ほし', 140, rubyLineAbove(500), RUBY),
    ]);
    expect(rubies.map((ruby) => ruby.reading)).toEqual(['わたし', 'ほし']);
  });

  it('縦書きのルビと横書きのルビが近くにあるとき、つながない', () => {
    const { rubies } = split([
      verticalItem('港', 100, 500, BASE),
      verticalItem('みなと', 100 + BASE / 2 + RUBY / 2, 505, RUBY),
      horizontalItem('船', 125, 470, BASE),
      horizontalItem('ふね', 125, rubyLineAbove(470), RUBY),
    ]);
    expect(rubies.map((ruby) => [ruby.reading, ruby.baseDirection])).toEqual([
      ['ふね', 'horizontal'],
      ['みなと', 'vertical'],
    ]);
  });
});

describe('isRubyBase', () => {
  const { body, rubies } = split([
    horizontalItem('私の星', 100, 500, BASE),
    horizontalItem('わたし', 95, rubyLineAbove(500), RUBY),
  ]);
  const glyphs = body.flatMap((run) => run.glyphs);
  const ruby = defined(rubies[0]);

  it('ルビの下で、字の長さの 1/3 以上がルビと重なる字のとき、親字になる', () => {
    expect(glyphs.filter((glyph) => isRubyBase(ruby, glyph)).map((glyph) => glyph.ch)).toEqual([
      '私',
    ]);
  });

  it('ルビの字より 1.6 倍以上大きくない字のとき、親字にならない', () => {
    const small: PlacedGlyph = { ...defined(glyphs[0]), size: RUBY };
    expect(isRubyBase(ruby, small)).toBe(false);
  });
});
