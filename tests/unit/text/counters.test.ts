import { describe, expect, it } from 'vitest';

import { readCounter } from '@/text/counters';
import countersTsv from '@/text/data/counters.tsv?raw';

describe('readCounter', () => {
  it.each([
    ['二十万', '本', 'にじゅうまんぼん'],
    ['三千五百', '円', 'さんぜんごひゃくえん'],
    ['一万二千', '人', 'いちまんにせんにん'],
    ['十一', 'つ', undefined],
    ['何', 'つ', undefined],
    ['三', '羽', undefined],
    ['百', '時', undefined],
  ])('「%s」＋「%s」のとき、%s になる', (numberText, counter, expected) => {
    expect(readCounter(numberText, counter)).toBe(expected);
  });

  it.each([
    ['0'],
    ['100000000'],
    ['二三'],
    ['二三十'],
    ['十十'],
    ['十百'],
    ['十〇'],
    ['万'],
    ['一万万'],
    ['三億'],
  ])('数として読めない「%s」のとき、undefined になる', (numberText) => {
    expect(readCounter(numberText, '本')).toBeUndefined();
  });
});

describe('counters.tsv', () => {
  // 300 は さんびゃく、3000 は さんぜん のように位の読みの頭が変わるので、
  // 表の読みは位の読みの頭（ひゃ・せん・まん）で始め、変わる字を残せるようにする
  const placeHeads = new Map([
    [11, 'ひゃ'],
    [12, 'せん'],
    [13, 'まん'],
  ]);
  const rows = countersTsv
    .split('\n')
    .slice(1)
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));

  it.each(rows.map((cells) => [cells[0], cells]))(
    '助数詞「%s」の行のとき、列が18あり、最後のメモが空でない',
    (_counter, cells) => {
      expect(cells).toHaveLength(18);
      expect(cells.at(-1)).not.toBe('');
    },
  );

  it.each(rows.map((cells) => [cells[0], cells]))(
    '助数詞「%s」の 100・1000・10000 の列のとき、位の読みで始まる',
    (_counter, cells) => {
      for (const [column, head] of placeHeads) {
        const reading = cells[column] ?? '';
        expect(reading === '' || reading.startsWith(head)).toBe(true);
      }
    },
  );
});
