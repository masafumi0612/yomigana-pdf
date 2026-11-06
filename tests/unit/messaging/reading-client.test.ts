import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRecentErrors } from '@/log';
import type { ReadingResult } from '@/messaging/messages';
import { type ReadingClientApi, requestReadings } from '@/messaging/reading-client';

/** テストで待つ時間の上限（ミリ秒） */
const TIMEOUT_MS = 100;
const RESULT: ReadingResult = {
  ok: true,
  value: [
    [
      {
        start: 0,
        end: 1,
        ruby: 'がっ',
        isAlways: false,
        word: { surface: '学校', reading: 'がっこう', isUserFixed: false },
      },
    ],
  ],
};

/**
 * テスト用の拡張の API の代わりを作る。offscreen document は新しく作れないことにする。
 * @param sendMessage 読みの問い合わせを送る関数
 * @param count 見つかる offscreen document の数
 * @returns 拡張の API の代わり
 */
function fakeApi(sendMessage: (message: unknown) => Promise<unknown>, count = 1): ReadingClientApi {
  return {
    runtime: {
      getContexts: () => Promise.resolve(Array.from({ length: count }, () => ({}))),
      getURL: (path: string) => `chrome-extension://test${path}`,
      sendMessage,
    },
    offscreen: { createDocument: () => Promise.reject(new Error('作れない')) },
  } as unknown as ReadingClientApi;
}

describe('requestReadings', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('形の合った返事が来たとき、その返事を返す', async () => {
    const api = fakeApi(() => Promise.resolve(RESULT));
    expect(await requestReadings(['学校'], {}, api)).toEqual(RESULT);
  });

  it('指定を省いたとき、すべての漢字に付ける段階と、空の利用者の辞書で問い合わせる', async () => {
    const sendMessage = vi.fn(() => Promise.resolve<unknown>(RESULT));
    await requestReadings(['学校'], {}, fakeApi(sendMessage));
    expect(sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'read-texts',
      texts: ['学校'],
      level: 'all',
      userDictionary: [],
    });
  });

  it('段階と利用者の辞書を指定したとき、その値で問い合わせる', async () => {
    const sendMessage = vi.fn(() => Promise.resolve<unknown>(RESULT));
    const options = { level: 'g2' as const, userDictionary: new Map([['林', 'はやし']]) };
    await requestReadings(['林'], options, fakeApi(sendMessage));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'g2', userDictionary: [['林', 'はやし']] }),
    );
  });

  it('offscreen document を用意できなかったとき、offscreen-unavailable になる', async () => {
    const api = fakeApi(() => Promise.resolve(RESULT), 0);
    expect(await requestReadings(['学校'], {}, api)).toEqual({
      ok: false,
      error: 'offscreen-unavailable',
    });
  });

  it('受け取る部品がないとき、no-response になる', async () => {
    const api = fakeApi(() => Promise.reject(new Error('Could not establish connection.')));
    expect(await requestReadings(['学校'], {}, api)).toEqual({
      ok: false,
      error: 'no-response',
    });
  });

  it('上限の時間までに返事が来ないとき、timeout になる', async () => {
    vi.useFakeTimers();
    const api = fakeApi(() => new Promise(() => undefined));
    const waiting = requestReadings(['学校'], { timeoutMs: TIMEOUT_MS }, api);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await waiting).toEqual({ ok: false, error: 'timeout' });
  });

  it('形のおかしい返事が来たとき、invalid-response になる', async () => {
    const api = fakeApi(() => Promise.resolve(undefined));
    expect(await requestReadings(['学校'], {}, api)).toEqual({
      ok: false,
      error: 'invalid-response',
    });
  });
});
