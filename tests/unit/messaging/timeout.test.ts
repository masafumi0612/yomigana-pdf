import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from '@/messaging/timeout';

/** テストで待つ時間の上限（ミリ秒） */
const TIMEOUT_MS = 100;

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('上限より前に終わったとき、その値を返す', async () => {
    expect(await withTimeout(Promise.resolve('値'), TIMEOUT_MS)).toEqual({ ok: true, value: '値' });
  });

  it('上限を過ぎたとき、timeout になる', async () => {
    const waiting = withTimeout(new Promise<never>(() => undefined), TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await waiting).toEqual({ ok: false, error: 'timeout' });
  });

  it('待ったものが失敗したとき、その失敗をそのまま投げる', async () => {
    await expect(withTimeout(Promise.reject(new Error('壊れた')), TIMEOUT_MS)).rejects.toThrow(
      '壊れた',
    );
  });

  it('終わったとき、時計を残さない', async () => {
    await withTimeout(Promise.resolve('値'), TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
