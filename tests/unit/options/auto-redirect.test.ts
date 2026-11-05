import { describe, expect, it } from 'vitest';

import { isAutoRedirectShownOn } from '@/options/auto-redirect';

describe('isAutoRedirectShownOn', () => {
  it('保存した値がオンで権限があるとき、オンに見せる', () => {
    expect(isAutoRedirectShownOn(true, true)).toBe(true);
  });

  it('保存した値がオンでも権限を外されたとき、オフに見せる', () => {
    expect(isAutoRedirectShownOn(true, false)).toBe(false);
  });

  it('権限があっても保存した値がオフのとき、オフに見せる', () => {
    expect(isAutoRedirectShownOn(false, true)).toBe(false);
  });

  it('保存した値がオフで権限もないとき、オフに見せる', () => {
    expect(isAutoRedirectShownOn(false, false)).toBe(false);
  });
});
