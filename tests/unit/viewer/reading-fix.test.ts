import { describe, expect, it } from 'vitest';

import {
  checkReadingFix,
  fixErrorMessage,
  type ReadingFixForm,
  readingFixFormOf,
} from '@/viewer/reading-fix';

/** 直した読みのない 図鑑 の窓 */
const FORM: ReadingFixForm = { surface: '図鑑', reading: 'ずかん', canRestore: false };

describe('readingFixFormOf', () => {
  it('字ごとに付けたルビの語のとき、語全体の書き方と読みを窓に出す', () => {
    expect(readingFixFormOf({ surface: '図鑑', reading: 'ずかん', isUserFixed: false })).toEqual(
      FORM,
    );
  });

  it('直した読みの語のとき、元に戻せるようにする', () => {
    expect(
      readingFixFormOf({ surface: '今日', reading: 'こんにち', isUserFixed: true }).canRestore,
    ).toBe(true);
  });
});

describe('checkReadingFix', () => {
  it('読みがひらがなのとき、前後の空白を除いて、語と読みの1件にする', () => {
    expect(checkReadingFix(FORM, ' ずかん ')).toEqual({
      ok: true,
      value: { surface: '図鑑', reading: 'ずかん' },
    });
  });

  it('読みにカタカナがあるとき、ひらがなでないことを理由にする', () => {
    expect(checkReadingFix(FORM, 'ズカン')).toEqual({
      ok: false,
      error: { field: 'reading', error: 'not-hiragana' },
    });
  });

  it('読みが空のとき、空であることを理由にする', () => {
    expect(checkReadingFix(FORM, '')).toEqual({
      ok: false,
      error: { field: 'reading', error: 'empty' },
    });
  });

  it('語が長すぎるとき、読みより先に語を理由にする', () => {
    const form = { ...FORM, surface: '漢'.repeat(21) };

    expect(checkReadingFix(form, 'ズカン')).toEqual({
      ok: false,
      error: { field: 'surface', error: 'too-long' },
    });
  });
});

describe('fixErrorMessage', () => {
  it('読みの理由のとき、設定の画面と同じ文言に、読みの字の数の上限を差し込む', () => {
    expect(fixErrorMessage({ field: 'reading', error: 'too-long' })).toEqual([
      'options_dict_readingTooLong',
      '40',
    ]);
  });

  it('語の理由のとき、語を入れられない文言に、語の字の数の上限を差し込む', () => {
    expect(fixErrorMessage({ field: 'surface', error: 'no-kanji' })).toEqual([
      'viewer_fix_surfaceInvalid',
      '20',
    ]);
  });
});
