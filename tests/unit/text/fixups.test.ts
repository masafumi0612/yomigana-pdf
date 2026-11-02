import { describe, expect, it } from 'vitest';

import readingFixesTsv from '@/text/data/reading-fixes.tsv?raw';
import { applyFixups, parseReadingFixes } from '@/text/fixups';
import { parseTsv } from '@/text/tsv';
import type { ReadingSource, Token, Word } from '@/text/types';

import fixturesTsv from '../../fixtures/fixups.tsv?raw';

/**
 * 表に書いた語を読む（surface/reading/pos/詳細1,詳細2 を ` | ` でつなぐ）。
 * @param cell 表のセル
 * @returns 語の並び
 */
function parseTokens(cell: string): Token[] {
  return cell.split(' | ').map((text) => {
    const [surface = '', reading = '', pos = '', details = ''] = text.split('/');
    return { surface, reading, pos, posDetails: details.split(',') };
  });
}

/**
 * 表に書いた期待する語を読む（surface/reading/source を ` | ` でつなぐ）。
 * @param cell 表のセル
 * @returns 語の並び
 */
function parseWords(cell: string): Word[] {
  return cell.split(' | ').map((text) => {
    const [surface = '', reading = '', source = ''] = text.split('/');
    return { surface, reading, source: source as ReadingSource };
  });
}

const noUserWords = new Map<string, string>();
const fixtures = parseTsv(fixturesTsv, ['文', 'トークン', '期待する語'] as const);

describe('applyFixups', () => {
  it.each(fixtures.map((row) => [row.文, row.トークン, row.期待する語]))(
    '「%s」のとき、読みを直した語の並びになる',
    (_text, tokens, expected) => {
      expect(applyFixups(parseTokens(tokens), noUserWords)).toEqual(parseWords(expected));
    },
  );

  it('語がないとき、空の並びになる', () => {
    expect(applyFixups([], noUserWords)).toEqual([]);
  });

  it('全角の数字のとき、半角と同じ読みになる', () => {
    const tokens = parseTokens('２３/ニサン/名詞/数 | 本/ホン/名詞/接尾,助数詞');
    expect(applyFixups(tokens, noUserWords)).toEqual(parseWords('２３本/にじゅうさんぼん/counter'));
  });
});

describe('applyFixups の利用者の辞書', () => {
  it('kuromoji が名前をいくつかの語に分けたとき、つないで1語にする', () => {
    const tokens = parseTokens('小鳥/コトリ/名詞/一般 | 遊//名詞/一般 | さん/サン/名詞/接尾,人名');
    expect(applyFixups(tokens, new Map([['小鳥遊', 'たかなし']]))).toEqual(
      parseWords('小鳥遊/たかなし/user | さん/さん/kuromoji'),
    );
  });

  it('いくつも当てはまるとき、いちばん長い語を使う', () => {
    const tokens = parseTokens('小鳥/コトリ/名詞/一般 | 遊//名詞/一般');
    const dictionary = new Map([
      ['小鳥', 'ことり'],
      ['小鳥遊', 'たかなし'],
    ]);
    expect(applyFixups(tokens, dictionary)).toEqual(parseWords('小鳥遊/たかなし/user'));
  });

  it('数＋助数詞にも当たるとき、利用者の辞書を使う', () => {
    const tokens = parseTokens('一/イチ/名詞/数 | 日/ニチ/名詞/接尾,助数詞');
    expect(applyFixups(tokens, new Map([['一日', 'ついたち']]))).toEqual(
      parseWords('一日/ついたち/user'),
    );
  });

  it('読みを直す表にも当たるとき、利用者の辞書を使う', () => {
    const tokens = parseTokens('令/リョウ/名詞/一般 | 和/ワ/名詞/一般');
    expect(applyFixups(tokens, new Map([['令和', 'れいわー']]))).toEqual(
      parseWords('令和/れいわー/user'),
    );
  });
});

describe('applyFixups の読みを直す表の条件', () => {
  const table = parseReadingFixes('語\t読み\t条件\tメモ\n角\tかど\t前:助詞\t\n角\tつの\t\t\n');

  it('前の語が条件に合うとき、条件のある行を使う', () => {
    const tokens = parseTokens('の/ノ/助詞/連体化 | 角/カク/名詞/一般');
    expect(applyFixups(tokens, noUserWords, table)).toEqual(
      parseWords('の/の/kuromoji | 角/かど/table'),
    );
  });

  it('前の語がないとき、条件のない行を使う', () => {
    const tokens = parseTokens('角/カク/名詞/一般');
    expect(applyFixups(tokens, noUserWords, table)).toEqual(parseWords('角/つの/table'));
  });
});

describe('parseReadingFixes', () => {
  it('条件の書き方が違うとき、例外を投げる', () => {
    expect(() => parseReadingFixes('語\t読み\t条件\tメモ\n米\tこめ\t後ろ:助詞\t\n')).toThrow(
      '条件が読めない',
    );
  });
});

describe('reading-fixes.tsv', () => {
  const rows = parseTsv(readingFixesTsv, ['語', '読み', '条件', 'メモ'] as const);

  it.each(rows.map((row) => [row.語, row]))(
    '「%s」のとき、読みが平仮名でメモがある',
    (_word, row) => {
      expect(row.読み).toMatch(/^[ぁ-ゖー]+$/u);
      expect(row.メモ).not.toBe('');
    },
  );
});
