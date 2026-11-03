import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { clearRecentErrors, createLogger, getRecentErrors } from '@/log';

/** 残す直近のエラーの数の上限 */
const MAX_RECENT_ERRORS = 20;

/** console の出し口ごとの、呼ばれた様子 */
type ConsoleSpies = Record<'debug' | 'info' | 'warn' | 'error', MockInstance>;

describe('createLogger', () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    clearRecentErrors();
    const silent = () => undefined;
    spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(silent),
      info: vi.spyOn(console, 'info').mockImplementation(silent),
      warn: vi.spyOn(console, 'warn').mockImplementation(silent),
      error: vi.spyOn(console, 'error').mockImplementation(silent),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debug を出さない設定のとき、debug を出さない', () => {
    createLogger('test', { isDebugEnabled: false }).debug('途中の様子');
    expect(spies.debug).not.toHaveBeenCalled();
  });

  it('debug を出す設定のとき、部品の名前を付けて debug を出す', () => {
    createLogger('test', { isDebugEnabled: true }).debug('途中の様子');
    expect(spies.debug).toHaveBeenCalledWith('[yomigana-pdf:test]', '途中の様子');
  });

  it('設定を省いたとき、開発のビルドかどうかで debug を出すかを決める', () => {
    createLogger('test').debug('途中の様子');
    expect(spies.debug.mock.calls.length).toBe(import.meta.env.DEV ? 1 : 0);
  });

  it('info と warn は、それぞれの出し口に出す', () => {
    const log = createLogger('test');
    log.info('知らせ');
    log.warn('気になること');
    expect([spies.info.mock.calls, spies.warn.mock.calls]).toEqual([
      [['[yomigana-pdf:test]', '知らせ']],
      [['[yomigana-pdf:test]', '気になること']],
    ]);
  });

  it('error に Error を渡したとき、名前と文だけを付けて残す', () => {
    createLogger('test').error('読めませんでした', new TypeError('壊れた'));
    expect(getRecentErrors().map(({ scope, message }) => ({ scope, message }))).toEqual([
      { scope: 'test', message: '読めませんでした：TypeError: 壊れた' },
    ]);
  });

  it('error に Error でないものを渡したとき、その種類だけを付ける', () => {
    createLogger('test').error('読めませんでした', { text: '本文' });
    expect(getRecentErrors()[0]?.message).toBe('読めませんでした：（object）');
  });

  it('error に文字列を渡したとき、その文字列を付ける', () => {
    createLogger('test').error('読めませんでした', 'timeout');
    expect(getRecentErrors()[0]?.message).toBe('読めませんでした：timeout');
  });

  it('error を上限より多く出したとき、新しいものから上限の数だけ残す', () => {
    const log = createLogger('test');
    for (let count = 0; count <= MAX_RECENT_ERRORS; count += 1) {
      log.error(`エラー${String(count)}`);
    }
    const errors = getRecentErrors();
    expect([errors.length, errors[0]?.message]).toEqual([MAX_RECENT_ERRORS, 'エラー1']);
  });

  it('直近のエラーを取り出したものを変えても、残したものは変わらない', () => {
    createLogger('test').error('読めませんでした');
    const errors = getRecentErrors() as unknown[];
    errors.length = 0;
    expect(getRecentErrors()).toHaveLength(1);
  });
});
