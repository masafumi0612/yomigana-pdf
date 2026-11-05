import { describe, expect, it } from 'vitest';

import { buildSkipRule } from '@/redirect/skip';

describe('buildSkipRule', () => {
  it('URL を渡したとき、そのタブのその URL の本体だけを除くルールになる', () => {
    const rule = buildSkipRule(7, 'https://example.com/a.pdf?x=1&y=(2)');

    expect(rule.id).toBe(7);
    expect(rule.action.type).toBe('allow');
    expect(rule.condition.tabIds).toEqual([7]);
    expect(rule.condition.resourceTypes).toEqual(['main_frame']);
    const pattern = new RegExp(rule.condition.regexFilter ?? '(?!)', 'u');
    expect(pattern.test('https://example.com/a.pdf?x=1&y=(2)')).toBe(true);
    expect(pattern.test('https://example.com/aXpdf?x=1&y=(2)')).toBe(false);
    expect(pattern.test('https://example.com/b.pdf')).toBe(false);
  });

  it('URL が長すぎるとき、URL を絞らずそのタブの本体を除く', () => {
    const rule = buildSkipRule(3, `https://example.com/${'a'.repeat(600)}.pdf`);

    expect(rule.condition.regexFilter).toBeUndefined();
    expect(rule.condition.tabIds).toEqual([3]);
  });
});
