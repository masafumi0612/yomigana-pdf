import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { splitReading } from '@/text/split';
import type { Seg, SplitResult, Word } from '@/text/types';

/** split.tsv の1行 */
interface SplitCase {
  readonly surface: string;
  readonly reading: string;
  readonly segs: string;
  readonly kind: string;
  readonly memo: string;
}

/**
 * 期待値の表を読む。1行目の見出しと、# で始まる行は飛ばす。
 * @returns 表の行
 */
function readCases(): SplitCase[] {
  const text = readFileSync(new URL('../../fixtures/split.tsv', import.meta.url), 'utf8');
  return text
    .split(/\r?\n/u)
    .filter((line) => line !== '' && !line.startsWith('#'))
    .slice(1)
    .map((line) => {
      const [surface = '', reading = '', segs = '', kind = '', memo = ''] = line.split('\t');
      return { surface, reading, segs, kind, memo };
    });
}

/**
 * 1つ分を、表の書き方（図:ず、薔:ば†、block:jukujikun:河岸:がし）にする。
 * @param seg 1つ分
 * @returns 表の書き方
 */
function formatSeg(seg: Seg): string {
  switch (seg.kind) {
    case 'kana': {
      return seg.base;
    }
    case 'kanji': {
      return `${seg.base}:${seg.reading}${seg.isHyogaiReading ? '†' : ''}`;
    }
    case 'block': {
      return `block:${seg.why}:${seg.base}:${seg.reading}`;
    }
  }
}

/**
 * 結果を、表の「字ごとの読み」の書き方にする。語全体の固まりは block:理由 と短く書く。
 * @param result 結果
 * @returns 表の書き方
 */
function formatSegs(result: SplitResult): string {
  const [only] = result.segs;
  if (
    result.segs.length === 1 &&
    only?.kind === 'block' &&
    only.base === result.word.surface &&
    only.reading === result.word.reading
  ) {
    return `block:${only.why}`;
  }
  return result.segs.map(formatSeg).join('|');
}

/**
 * 結果の種類（表の「種類」の列）を決める。
 * @param result 結果
 * @returns 固まりがあればその理由、漢字があれば split、なければ kana
 */
function kindOf(result: SplitResult): string {
  const block = result.segs.find((seg) => seg.kind === 'block');
  if (block !== undefined) return block.why;
  return result.segs.some((seg) => seg.kind === 'kanji') ? 'split' : 'kana';
}

/**
 * 表の語から、手直しのあとの1語を作る。
 * @param surface 書き方
 * @param reading 読み
 * @returns 1語
 */
function wordOf(surface: string, reading: string): Word {
  return { surface, reading, source: 'kuromoji' };
}

const cases = readCases();

describe('splitReading', () => {
  it.each(cases)(
    '「$surface」を「$reading」と読むとき、$segs（$kind）になる。$memo',
    ({ surface, reading, segs, kind }) => {
      const result = splitReading(wordOf(surface, reading));
      expect({ segs: formatSegs(result), kind: kindOf(result) }).toEqual({ segs, kind });
    },
  );

  it.each(cases)(
    '「$surface」を分けたとき、base をつなぐと元の書き方になる',
    ({ surface, reading }) => {
      const result = splitReading(wordOf(surface, reading));
      expect(result.segs.map((seg) => seg.base).join('')).toBe(surface);
    },
  );

  it('語を分けたとき、結果に元の語がそのまま入る', () => {
    const word: Word = { surface: '図鑑', reading: 'ずかん', source: 'user' };
    expect(splitReading(word).word).toBe(word);
  });

  it('読みに片仮名が混ざるとき、平仮名と同じように合わせ、ルビは元の読みのまま切り出す', () => {
    const result = splitReading(wordOf('学校', 'ガッこう'));
    expect(result.segs).toEqual([
      { kind: 'kanji', base: '学', reading: 'ガッ', isHyogaiReading: false },
      { kind: 'kanji', base: '校', reading: 'こう', isHyogaiReading: false },
    ]);
  });
});
