import { describe, expect, it } from 'vitest';
import type { Browser } from 'wxt/browser';

import { type DynamicRuleStore, shouldRegisterRules, syncRedirectRules } from '@/redirect/register';
import { buildRedirectRules } from '@/redirect/rules';

type Rule = Browser.declarativeNetRequest.Rule;

const VIEWER_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/viewer.html';

/** 登録済みのルールを覚えるだけの入れ物 */
function createStore(
  initial: Rule[] = [],
): DynamicRuleStore & { rules: Rule[]; updateCount: number } {
  const store = {
    rules: initial,
    updateCount: 0,
    getRules: () => Promise.resolve(store.rules),
    updateRules: (removeRuleIds: number[], addRules: Rule[]) => {
      store.updateCount += 1;
      store.rules = [
        ...store.rules.filter((rule) => !removeRuleIds.includes(rule.id)),
        ...addRules,
      ];
      return Promise.resolve();
    },
  };
  return store;
}

describe('shouldRegisterRules', () => {
  it.each([
    { isEnabled: true, hasHostAccess: true, expected: true },
    { isEnabled: true, hasHostAccess: false, expected: false },
    { isEnabled: false, hasHostAccess: true, expected: false },
    { isEnabled: false, hasHostAccess: false, expected: false },
  ])(
    'スイッチが $isEnabled で権限が $hasHostAccess のとき、登録するかは $expected',
    ({ isEnabled, hasHostAccess, expected }) => {
      expect(shouldRegisterRules({ isEnabled, hasHostAccess })).toBe(expected);
    },
  );
});

describe('syncRedirectRules', () => {
  it('スイッチがオンで権限があるとき、ルールを登録する', async () => {
    const store = createStore();

    const isChanged = await syncRedirectRules(store, VIEWER_URL, {
      isEnabled: true,
      hasHostAccess: true,
    });

    expect(isChanged).toBe(true);
    expect(store.rules).toEqual(buildRedirectRules(VIEWER_URL));
  });

  it('権限が外されたとき、登録済みのルールをすべて消す', async () => {
    const store = createStore(buildRedirectRules(VIEWER_URL));

    const isChanged = await syncRedirectRules(store, VIEWER_URL, {
      isEnabled: true,
      hasHostAccess: false,
    });

    expect(isChanged).toBe(true);
    expect(store.rules).toEqual([]);
  });

  it('すでに同じルールがあるとき、入れ替えない', async () => {
    const store = createStore(buildRedirectRules(VIEWER_URL));

    const isChanged = await syncRedirectRules(store, VIEWER_URL, {
      isEnabled: true,
      hasHostAccess: true,
    });

    expect(isChanged).toBe(false);
    expect(store.updateCount).toBe(0);
  });

  it('何も登録しておらず登録しない状態のとき、何もしない', async () => {
    const store = createStore();

    const isChanged = await syncRedirectRules(store, VIEWER_URL, {
      isEnabled: false,
      hasHostAccess: true,
    });

    expect(isChanged).toBe(false);
    expect(store.updateCount).toBe(0);
  });
});
