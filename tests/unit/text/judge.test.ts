import { describe, expect, it } from 'vitest';

import { judge } from '@/text/judge';
import type { Level, RubyPiece, Seg, SplitResult } from '@/text/types';

// 字ごとの分割はべつに作っているので、ここでは SplitResult を手で組み立てる

/**
 * 漢字1字の seg を作る。
 * @param base 漢字1字
 * @param reading その字の読み（平仮名）
 * @param isHyogaiReading 表外音訓なら true
 * @returns 漢字の seg
 */
function kanji(base: string, reading: string, isHyogaiReading = false): Seg {
  return { kind: 'kanji', base, reading, isHyogaiReading };
}

/**
 * 仮名の seg を作る。
 * @param base 仮名や記号
 * @returns 仮名の seg
 */
function kana(base: string): Seg {
  return { kind: 'kana', base };
}

/**
 * seg を並べて1語の結果を作る。語の読みは、テストでは使わないので空にする。
 * @param segs 語の頭から順に並べた seg
 * @returns 1語を字ごとに分けた結果
 */
function word(...segs: Seg[]): SplitResult {
  const surface = segs.map((seg) => seg.base).join('');
  return { word: { surface, reading: '', source: 'kuromoji' }, segs };
}

/**
 * seg 1つだけの語を判定する。
 * @param seg 判定する seg
 * @param level 利用者の段階
 * @returns その seg の判定
 */
function judgeOne(seg: Seg, level: Level): RubyPiece | undefined {
  return judge(word(seg), level)[0];
}

describe('judge：仮名', () => {
  it.each<Level>(['all', 'g3', 'joyo'])('段階 %s で仮名のとき、ルビなしになる', (level) => {
    expect(judgeOne(kana('みる'), level)).toEqual({
      base: 'みる',
      ruby: undefined,
      isAlways: false,
    });
  });
});

describe('judge：漢字（方式 C）', () => {
  it.each<[string, string, string, Level, string | undefined]>([
    // 字（段階）, 読み, 段階の説明, 利用者の段階, 付くルビ
    ['図', 'ず', 'g2', 'all', 'ず'],
    ['図', 'ず', 'g2', 'g3', undefined],
    ['窓', 'まど', 'g6', 'g3', 'まど'],
    ['窓', 'まど', 'g6', 'g6', undefined],
    ['鑑', 'かん', 'm1', 'g6', 'かん'],
    ['鑑', 'かん', 'm1', 'm1', undefined],
    ['叱', 'しか', 'm2・許容字体', 'm1', 'しか'],
    ['叱', 'しか', 'm2・許容字体', 'joyo', undefined],
    ['鬱', 'うつ', 'joyo', 'm1', 'うつ'],
    ['鬱', 'うつ', 'joyo', 'joyo', undefined],
  ])(
    '「%s」（%s 段階 %s）を段階 %s で読むとき、ルビが %s になる',
    (base, reading, _tier, level, ruby) => {
      expect(judgeOne(kanji(base, reading), level)).toEqual({ base, ruby, isAlways: false });
    },
  );

  it.each<Level>(['all', 'g3', 'joyo'])(
    '表外字「薔」を段階 %s で読むとき、いつも付くルビになる',
    (level) => {
      expect(judgeOne(kanji('薔', 'しょう'), level)).toEqual({
        base: '薔',
        ruby: 'しょう',
        isAlways: true,
      });
    },
  );

  it.each<[string, string, Level]>([
    ['解', 'ほど', 'joyo'],
    ['堪', 'こら', 'joyo'],
    ['解', 'ほど', 'all'],
  ])('表外音訓「%s（%s）」を段階 %s で読むとき、いつも付くルビになる', (base, reading, level) => {
    expect(judgeOne(kanji(base, reading, true), level)).toEqual({
      base,
      ruby: reading,
      isAlways: true,
    });
  });

  it.each<[string, Level]>([
    ['図', 'all'],
    ['窓', 'g3'],
    ['薔', 'joyo'],
  ])('「%s」の読みが空のとき、段階 %s でもルビなしになる', (base, level) => {
    expect(judgeOne(kanji(base, ''), level)).toEqual({ base, ruby: undefined, isAlways: false });
  });
});

describe('judge：字ごとに分けられない語', () => {
  it.each<[string, string, 'jukujikun' | 'irregular', Level]>([
    ['今日', 'きょう', 'jukujikun', 'joyo'],
    ['大人', 'おとな', 'jukujikun', 'all'],
    ['寿司', 'すし', 'irregular', 'g6'],
  ])(
    '「%s」（%s・%s）を段階 %s で読むとき、語全体にいつも付くルビになる',
    (base, reading, why, level) => {
      expect(judgeOne({ kind: 'block', base, reading, why }, level)).toEqual({
        base,
        ruby: reading,
        isAlways: true,
      });
    },
  );

  it.each<[string, string, Level]>([
    ['翔太', '', 'all'],
    ['翔太', 'しょうた', 'g3'],
  ])(
    '読みが分からない語「%s」（読み「%s」）を段階 %s で読むとき、ルビなしになる',
    (base, reading, level) => {
      expect(judgeOne({ kind: 'block', base, reading, why: 'unknown' }, level)).toEqual({
        base,
        ruby: undefined,
        isAlways: false,
      });
    },
  );
});

describe('judge：1語全体', () => {
  it('「鑑みる」を段階 g6 で読むとき、漢字にだけルビが付き、base をつなぐと語の書き方になる', () => {
    const result = word(kanji('鑑', 'かんが'), kana('みる'));
    const pieces = judge(result, 'g6');

    expect(pieces).toEqual([
      { base: '鑑', ruby: 'かんが', isAlways: false },
      { base: 'みる', ruby: undefined, isAlways: false },
    ]);
    expect(pieces.map((piece) => piece.base).join('')).toBe(result.word.surface);
  });

  it('「窓口」を段階 g3 で読むとき、まだ習わない「窓」にだけルビが付いた形になる', () => {
    expect(judge(word(kanji('窓', 'まど'), kanji('口', 'ぐち')), 'g3')).toEqual([
      { base: '窓', ruby: 'まど', isAlways: false },
      { base: '口', ruby: undefined, isAlways: false },
    ]);
  });

  it('seg が1つもないとき、空の配列になる', () => {
    expect(judge(word(), 'all')).toEqual([]);
  });
});
