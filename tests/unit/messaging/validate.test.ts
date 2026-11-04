import { describe, expect, it } from 'vitest';

import type { ReadingRequest } from '@/messaging/messages';
import {
  isReadingRequest,
  isReadingResult,
  isWorkerRequest,
  isWorkerResponse,
  LEVELS,
} from '@/messaging/validate';
import { KANJI_TIERS } from '@/text/kanji-data';

const REQUEST: ReadingRequest = {
  target: 'offscreen',
  type: 'read-texts',
  texts: ['学校'],
  level: 'g3',
  userDictionary: [['林', 'はやし']],
};
const SPAN = { start: 0, end: 1, ruby: 'がっ', isAlways: false };

describe('LEVELS', () => {
  it('all と、漢字の段階のすべてを、習う順に並べたものになる', () => {
    expect(LEVELS).toEqual(['all', ...KANJI_TIERS]);
  });
});

describe('isReadingRequest', () => {
  it('形の合った問い合わせのとき、true になる', () => {
    expect(isReadingRequest(REQUEST)).toBe(true);
  });

  it.each([
    ['オブジェクトでない', '学校'],
    ['配列', [REQUEST]],
    ['宛先が違う', { ...REQUEST, target: 'background' }],
    ['種類が違う', { ...REQUEST, type: 'stats' }],
    ['文が文字列の配列でない', { ...REQUEST, texts: [1] }],
    ['段階が知らないもの', { ...REQUEST, level: 'g7' }],
    ['利用者の辞書が組でない', { ...REQUEST, userDictionary: [['林']] }],
    ['利用者の辞書が配列でない', { ...REQUEST, userDictionary: { 林: 'はやし' } }],
  ])('%sとき、false になる', (_label, value) => {
    expect(isReadingRequest(value)).toBe(false);
  });
});

describe('isReadingResult', () => {
  it('うまくいった返事のとき、true になる', () => {
    expect(isReadingResult({ ok: true, value: [[SPAN], []] })).toBe(true);
  });

  it('失敗の返事のとき、true になる', () => {
    expect(isReadingResult({ ok: false, error: 'timeout' })).toBe(true);
  });

  it.each([
    ['オブジェクトでない', undefined],
    ['ok がない', { value: [] }],
    ['失敗の理由が知らないもの', { ok: false, error: 'broken' }],
    ['文ごとの並びが配列でない', { ok: true, value: [SPAN] }],
    ['頭の位置が整数でない', { ok: true, value: [[{ ...SPAN, start: 0.5 }]] }],
    ['頭の位置が負', { ok: true, value: [[{ ...SPAN, start: -1 }]] }],
    ['終わりが頭より前', { ok: true, value: [[{ ...SPAN, start: 1, end: 1 }]] }],
    ['ルビが文字列でない', { ok: true, value: [[{ ...SPAN, ruby: 1 }]] }],
    ['いつも付けるかが真偽値でない', { ok: true, value: [[{ ...SPAN, isAlways: 'yes' }]] }],
  ])('%sとき、false になる', (_label, value) => {
    expect(isReadingResult(value)).toBe(false);
  });
});

describe('isWorkerRequest', () => {
  it('番号と問い合わせがあるとき、true になる', () => {
    expect(isWorkerRequest({ id: 1, request: REQUEST })).toBe(true);
  });

  it('番号が整数でないとき、false になる', () => {
    expect(isWorkerRequest({ id: '1', request: REQUEST })).toBe(false);
  });
});

describe('isWorkerResponse', () => {
  it('番号と返事があるとき、true になる', () => {
    expect(isWorkerResponse({ id: 1, result: { ok: false, error: 'timeout' } })).toBe(true);
  });

  it('返事の形がおかしいとき、false になる', () => {
    expect(isWorkerResponse({ id: 1, result: { ok: 'yes' } })).toBe(false);
  });
});
