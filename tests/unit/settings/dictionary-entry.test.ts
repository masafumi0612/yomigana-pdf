import { describe, expect, it } from 'vitest';

import {
  MAX_READING_LENGTH,
  MAX_SURFACE_LENGTH,
  parseReading,
  parseSurface,
  toEntry,
  toUserDictionary,
} from '@/settings/dictionary-entry';

describe('parseSurface', () => {
  it('漢字を含む言葉のとき、前後の空白を除いて受け付ける', () => {
    expect(parseSurface('  小鳥遊 ')).toEqual({ ok: true, value: '小鳥遊' });
  });

  it('漢字と仮名がまざった言葉のとき、受け付ける', () => {
    expect(parseSurface('林さん')).toEqual({ ok: true, value: '林さん' });
  });

  it('々 を含む言葉のとき、受け付ける', () => {
    expect(parseSurface('佐々木')).toEqual({ ok: true, value: '佐々木' });
  });

  it('部首の字（⽇）のとき、PDF の文と同じく NFKC でそろえる', () => {
    expect(parseSurface('⽇向')).toEqual({ ok: true, value: '日向' });
  });

  it('空白だけのとき、空として受け付けない', () => {
    expect(parseSurface('　 ')).toEqual({ ok: false, error: 'empty' });
  });

  it('漢字がないとき、受け付けない', () => {
    expect(parseSurface('たかなし')).toEqual({ ok: false, error: 'no-kanji' });
  });

  it('上限の字数のとき、受け付ける', () => {
    expect(parseSurface('漢'.repeat(MAX_SURFACE_LENGTH)).ok).toBe(true);
  });

  it('上限より長いとき、受け付けない', () => {
    expect(parseSurface('漢'.repeat(MAX_SURFACE_LENGTH + 1))).toEqual({
      ok: false,
      error: 'too-long',
    });
  });

  it('2つの番号で表す字（𠮟）のとき、1字と数える', () => {
    expect(parseSurface('𠮟'.repeat(MAX_SURFACE_LENGTH)).ok).toBe(true);
  });
});

describe('parseReading', () => {
  it('平仮名のとき、前後の空白を除いて受け付ける', () => {
    expect(parseReading(' たかなし ')).toEqual({ ok: true, value: 'たかなし' });
  });

  it('長音（ー）を含むとき、受け付ける', () => {
    expect(parseReading('じぇーむず')).toEqual({ ok: true, value: 'じぇーむず' });
  });

  it('空のとき、受け付けない', () => {
    expect(parseReading('')).toEqual({ ok: false, error: 'empty' });
  });

  it('片仮名のとき、受け付けない', () => {
    expect(parseReading('タカナシ')).toEqual({ ok: false, error: 'not-hiragana' });
  });

  it('間に空白があるとき、受け付けない', () => {
    expect(parseReading('たか なし')).toEqual({ ok: false, error: 'not-hiragana' });
  });

  it('上限より長いとき、受け付けない', () => {
    expect(parseReading('あ'.repeat(MAX_READING_LENGTH + 1))).toEqual({
      ok: false,
      error: 'too-long',
    });
  });
});

describe('toEntry', () => {
  it('決まりに合う組のとき、1件になる', () => {
    expect(toEntry(['林', 'はやし'])).toEqual({ surface: '林', reading: 'はやし' });
  });

  it.each([
    ['組でない', '林'],
    ['数が合わない', ['林', 'はやし', 'りん']],
    ['文字列でない', ['林', 1]],
    ['読みが片仮名', ['林', 'ハヤシ']],
    ['言葉に漢字がない', ['かな', 'かな']],
    ['言葉の前後に空白がある', [' 林', 'はやし']],
    ['読みの前後に空白がある', ['林', 'はやし ']],
  ])('%s とき、undefined になる', (_, value) => {
    expect(toEntry(value)).toBeUndefined();
  });
});

describe('toUserDictionary', () => {
  it('言葉から読みを引く表になる', () => {
    const dictionary = toUserDictionary([{ surface: '林', reading: 'はやし' }]);

    expect(dictionary.get('林')).toBe('はやし');
  });
});
