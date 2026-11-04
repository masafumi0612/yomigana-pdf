import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRecentErrors, getRecentErrors } from '@/log';
import type { ReadingRequest, ReadingResult } from '@/messaging/messages';
import {
  createOffscreenListener,
  ensureOffscreenDocument,
  OFFSCREEN_PATH,
  type OffscreenApi,
} from '@/messaging/offscreen';
import type { WorkerClient } from '@/messaging/worker';

const REQUEST: ReadingRequest = {
  target: 'offscreen',
  type: 'read-texts',
  texts: ['学校'],
  level: 'all',
  userDictionary: [],
};
const RESULT: ReadingResult = { ok: true, value: [[]] };

/** テスト用の拡張の API の代わり */
interface FakeApi {
  readonly api: OffscreenApi;
  readonly getContexts: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>;
  readonly createDocument: ReturnType<typeof vi.fn<(parameters: unknown) => Promise<void>>>;
}

/**
 * テスト用の拡張の API の代わりを作る。
 * @param counts getContexts が順に返す、見つかった offscreen document の数
 * @returns 拡張の API の代わり
 */
function fakeApi(...counts: number[]): FakeApi {
  const getContexts = vi.fn<() => Promise<unknown[]>>();
  for (const count of counts) {
    getContexts.mockResolvedValueOnce(Array.from({ length: count }, () => ({})));
  }
  const createDocument = vi.fn<(parameters: unknown) => Promise<void>>().mockResolvedValue();
  const api = {
    runtime: { getContexts, getURL: (path: string) => `chrome-extension://test${path}` },
    offscreen: { createDocument },
  } as unknown as OffscreenApi;
  return { api, getContexts, createDocument };
}

/**
 * 決まった返事をする、Worker に問い合わせるものの代わりを作る。
 * @param request 問い合わせる関数
 * @returns Worker に問い合わせるものの代わり
 */
function clientOf(request: WorkerClient['request']): WorkerClient {
  return { request };
}

describe('ensureOffscreenDocument', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  it('もうあるとき、作らない', async () => {
    const { api, createDocument } = fakeApi(1);
    expect([await ensureOffscreenDocument(api), createDocument.mock.calls.length]).toEqual([
      { ok: true, value: undefined },
      0,
    ]);
  });

  it('ないとき、Worker を使う理由で作る', async () => {
    const { api, createDocument } = fakeApi(0);
    await ensureOffscreenDocument(api);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: OFFSCREEN_PATH, reasons: ['WORKERS'] }),
    );
  });

  it('同時に呼んだとき、1つだけ作る', async () => {
    const { api, createDocument } = fakeApi(0, 0);
    await Promise.all([ensureOffscreenDocument(api), ensureOffscreenDocument(api)]);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it('ほかの呼び出しが作っている途中で見つかったとき、作り終えるまで待つ', async () => {
    const { api, createDocument } = fakeApi(0, 1);
    let finish: (() => void) | undefined;
    createDocument.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const order: string[] = [];

    const first = ensureOffscreenDocument(api).then(() => order.push('first'));
    const second = ensureOffscreenDocument(api).then(() => order.push('second'));
    await vi.waitFor(() => {
      expect(createDocument).toHaveBeenCalled();
    });
    order.push('created');
    finish?.();
    await Promise.all([first, second]);

    expect(order[0]).toBe('created');
  });

  it('作るのに失敗しても、ほかが作っていたとき、用意できたことにする', async () => {
    const { api, createDocument } = fakeApi(0, 1);
    createDocument.mockRejectedValueOnce(new Error('Only a single offscreen document'));
    expect(await ensureOffscreenDocument(api)).toEqual({ ok: true, value: undefined });
  });

  it('作れなかったとき、offscreen-unavailable になり、エラーを残す', async () => {
    const { api, createDocument } = fakeApi(0, 0);
    createDocument.mockRejectedValueOnce(new Error('壊れた'));
    expect([await ensureOffscreenDocument(api), getRecentErrors().length]).toEqual([
      { ok: false, error: 'offscreen-unavailable' },
      1,
    ]);
  });

  it('あるかを確かめられなかったとき、offscreen-unavailable になる', async () => {
    const { api, getContexts } = fakeApi();
    getContexts.mockRejectedValue(new Error('壊れた'));
    expect(await ensureOffscreenDocument(api)).toEqual({
      ok: false,
      error: 'offscreen-unavailable',
    });
  });
});

describe('createOffscreenListener', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  it('形の合った問い合わせが来たとき、true を返し、Worker の返事を送る', async () => {
    const sendResponse = vi.fn<(response: ReadingResult) => void>();
    const listener = createOffscreenListener(clientOf(() => Promise.resolve(RESULT)));
    expect(listener(REQUEST, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(RESULT);
    });
  });

  it.each([
    ['オブジェクトでない', '学校'],
    ['宛先がない', { type: 'read-texts' }],
    ['宛先がほかの部品の', { ...REQUEST, target: 'background' }],
  ])('%sメッセージのとき、受け取らない', (_label, message) => {
    const request = vi.fn<WorkerClient['request']>();
    const listener = createOffscreenListener(clientOf(request));
    expect([listener(message, {}, vi.fn()), request.mock.calls.length]).toEqual([undefined, 0]);
  });

  it('宛先が offscreen で形がおかしいとき、受け取らずにエラーを残す', () => {
    const listener = createOffscreenListener(clientOf(vi.fn()));
    expect([listener({ target: 'offscreen' }, {}, vi.fn()), getRecentErrors().length]).toEqual([
      undefined,
      1,
    ]);
  });

  it('Worker への問い合わせが思いがけず失敗したとき、エラーを残す', async () => {
    const listener = createOffscreenListener(clientOf(() => Promise.reject(new Error('壊れた'))));
    listener(REQUEST, {}, vi.fn());
    await vi.waitFor(() => {
      expect(getRecentErrors()).toHaveLength(1);
    });
  });
});
