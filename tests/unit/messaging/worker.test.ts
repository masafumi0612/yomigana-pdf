import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRecentErrors, getRecentErrors } from '@/log';
import type {
  ReadingRequest,
  ReadingResult,
  WorkerRequest,
  WorkerResponse,
} from '@/messaging/messages';
import { createWorkerClient, createWorkerListener, type WorkerPort } from '@/messaging/worker';
import type { ReadingService } from '@/text/reading-service';

/** テストで待つ時間の上限（ミリ秒） */
const TIMEOUT_MS = 100;
const REQUEST: ReadingRequest = {
  target: 'offscreen',
  type: 'read-texts',
  texts: ['学校'],
  level: 'all',
  userDictionary: [['林', 'はやし']],
};
const RESULT: ReadingResult = { ok: true, value: [[]] };

/** テスト用の Worker の代わり */
interface FakePort extends WorkerPort {
  /** 送られた問い合わせ */
  readonly sent: WorkerRequest[];
  /**
   * Worker から返事が来たことにする。
   * @param data 返事
   */
  reply(data: unknown): void;
}

/**
 * テスト用の Worker の代わりを作る。
 * @returns Worker の代わり
 */
function fakePort(): FakePort {
  const sent: WorkerRequest[] = [];
  const listeners: ((event: MessageEvent<unknown>) => void)[] = [];
  return {
    sent,
    postMessage(message) {
      sent.push(message);
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    reply(data) {
      for (const listener of listeners) {
        listener(new MessageEvent('message', { data }));
      }
    },
  };
}

/**
 * 決まった返事をする、読みの問い合わせに答えるものの代わりを作る。
 * @param read 問い合わせに答える関数
 * @returns 読みの問い合わせに答えるものの代わり
 */
function serviceOf(read: ReadingService['read']): ReadingService {
  return { read };
}

/**
 * offscreen document から問い合わせが来たことにするイベントを作る。
 * @param data 問い合わせ
 * @returns message のイベント
 */
function messageOf(data: unknown): MessageEvent<unknown> {
  return new MessageEvent('message', { data });
}

describe('createWorkerClient', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Worker から同じ番号の返事が来たとき、その返事を返す', async () => {
    const port = fakePort();
    const waiting = createWorkerClient(port, TIMEOUT_MS).request(REQUEST);
    port.reply({ id: port.sent[0]?.id, result: RESULT });
    expect(await waiting).toEqual(RESULT);
  });

  it('問い合わせるたびに、違う番号を付けて送る', async () => {
    const port = fakePort();
    const client = createWorkerClient(port, TIMEOUT_MS);
    const waiting = [client.request(REQUEST), client.request(REQUEST)];
    for (const { id } of port.sent) {
      port.reply({ id, result: RESULT });
    }
    await Promise.all(waiting);
    expect(port.sent.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('形のおかしい返事が来たとき、無視してエラーを残す', () => {
    const port = fakePort();
    createWorkerClient(port, TIMEOUT_MS);
    port.reply({ id: 1, result: 'broken' });
    expect(getRecentErrors()).toHaveLength(1);
  });

  it('上限の時間までに返事が来ないとき、timeout になる', async () => {
    vi.useFakeTimers();
    const port = fakePort();
    const waiting = createWorkerClient(port, TIMEOUT_MS).request(REQUEST);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await waiting).toEqual({ ok: false, error: 'timeout' });
  });
});

describe('createWorkerListener', () => {
  beforeEach(() => {
    clearRecentErrors();
  });

  it('形の合った問い合わせが来たとき、同じ番号で答えを送る', async () => {
    const read = vi.fn<ReadingService['read']>().mockResolvedValue({ ok: true, value: [[]] });
    const post = vi.fn<(response: WorkerResponse) => void>();
    createWorkerListener(serviceOf(read), post)(messageOf({ id: 7, request: REQUEST }));
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith({ id: 7, result: { ok: true, value: [[]] } });
    });
  });

  it('利用者の辞書を、書き方から読みを引ける形にして渡す', () => {
    const read = vi.fn<ReadingService['read']>().mockResolvedValue({ ok: true, value: [] });
    createWorkerListener(serviceOf(read), vi.fn())(messageOf({ id: 1, request: REQUEST }));
    expect(read).toHaveBeenCalledWith(['学校'], {
      level: 'all',
      userDictionary: new Map([['林', 'はやし']]),
    });
  });

  it('形のおかしい問い合わせが来たとき、答えずにエラーを残す', () => {
    const read = vi.fn<ReadingService['read']>();
    createWorkerListener(serviceOf(read), vi.fn())(messageOf({ id: 1 }));
    expect([read.mock.calls.length, getRecentErrors().length]).toEqual([0, 1]);
  });

  it('答えを作る途中で思いがけず失敗したとき、エラーを残す', async () => {
    const read = vi.fn<ReadingService['read']>().mockRejectedValue(new Error('壊れた'));
    createWorkerListener(serviceOf(read), vi.fn())(messageOf({ id: 1, request: REQUEST }));
    await vi.waitFor(() => {
      expect(getRecentErrors()).toHaveLength(1);
    });
  });
});
