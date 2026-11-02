import { describe, expect, it } from 'vitest';

import { parseTsv } from '@/text/tsv';

const columns = ['語', '読み'] as const;

describe('parseTsv', () => {
  it('行の終わりのセルを省いたとき、空の文字列になる', () => {
    expect(parseTsv('語\t読み\n令和\n', columns)).toEqual([{ 語: '令和', 読み: '' }]);
  });

  it('空の行や CRLF の改行があるとき、飛ばして読む', () => {
    expect(parseTsv('語\t読み\r\n\r\n令和\tれいわ\r\n', columns)).toEqual([
      { 語: '令和', 読み: 'れいわ' },
    ]);
  });

  it('列の名前が違うとき、例外を投げる', () => {
    expect(() => parseTsv('語\t読みかた\n', columns)).toThrow('列の名前が違う');
  });

  it('空の表のとき、例外を投げる', () => {
    expect(() => parseTsv('', columns)).toThrow('列の名前が違う');
  });

  it('列が多すぎる行があるとき、例外を投げる', () => {
    expect(() => parseTsv('語\t読み\n令和\tれいわ\tあまり\n', columns)).toThrow('列が多すぎる');
  });
});
