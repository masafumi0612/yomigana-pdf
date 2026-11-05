import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { dismissWelcome, getWelcomeShown, isWelcomeShown, startWelcome } from '@/options/welcome';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('isWelcomeShown', () => {
  it('初めて入れたあと閉じていないとき（false）、出す', () => {
    expect(isWelcomeShown(false)).toBe(true);
  });

  it('閉じたあと（true）、出さない', () => {
    expect(isWelcomeShown(true)).toBe(false);
  });

  it('値がないとき（前の版から更新したとき）、出さない', () => {
    expect(isWelcomeShown(undefined)).toBe(false);
  });

  it('形の合わない値のとき、出さない', () => {
    expect(isWelcomeShown('false')).toBe(false);
  });
});

describe('getWelcomeShown', () => {
  it('何も残していないとき、出さない', async () => {
    expect(await getWelcomeShown()).toBe(false);
  });

  it('初めて入れたことを残したとき、出す', async () => {
    await startWelcome();

    expect(await getWelcomeShown()).toBe(true);
  });

  it('入れたあとに閉じたとき、出さない', async () => {
    await startWelcome();
    await dismissWelcome();

    expect(await getWelcomeShown()).toBe(false);
  });

  it('入れたことを storage.sync ではなく storage.local に残す', async () => {
    await startWelcome();

    expect([
      await fakeBrowser.storage.local.get('welcomeDismissed'),
      await fakeBrowser.storage.sync.get('welcomeDismissed'),
    ]).toEqual([{ welcomeDismissed: false }, {}]);
  });
});
