import { describe, expect, it } from 'vitest';

import { buildRedirectRules } from '@/redirect/rules';

const VIEWER_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/viewer.html';

describe('buildRedirectRules', () => {
  const rules = buildRedirectRules(VIEWER_URL);

  it('ルールの id がすべて違うとき、重ならずに登録できる', () => {
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  });

  it('前にあるルールほど、優先度が高い', () => {
    const priorities = rules.map((rule) => rule.priority ?? 0);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    expect(new Set(priorities).size).toBe(rules.length);
  });

  it('移すルールのとき、元の URL 全体をリーダーの URL の後ろに付ける', () => {
    const redirects = rules.filter((rule) => rule.action.type === 'redirect');
    expect(redirects.length).toBeGreaterThan(0);
    for (const rule of redirects) {
      expect(rule.action.redirect?.regexSubstitution).toBe(`${VIEWER_URL}?DNR:\\0`);
    }
  });

  it('PDF の種類で返ってきたとき、POST を除いて移す', () => {
    const rule = rules.find((r) =>
      r.condition.responseHeaders?.some((h) => h.values?.includes('application/pdf') === true),
    );
    expect(rule?.action.type).toBe('redirect');
    expect(rule?.condition.excludedRequestMethods).toEqual(['post']);
    expect(rule?.condition.resourceTypes).toEqual(['main_frame', 'sub_frame']);
  });

  it('octet-stream で返ってきたとき、URL が .pdf を含むものだけ移す', () => {
    const rule = rules.find((r) =>
      r.condition.responseHeaders?.some(
        (h) => h.values?.includes('application/octet-stream') === true,
      ),
    );
    const pattern = new RegExp(rule?.condition.regexFilter ?? '(?!)', 'u');
    expect(pattern.test('https://example.com/a.pdf')).toBe(true);
    expect(pattern.test('https://example.com/a.pdf?x=1')).toBe(true);
    expect(pattern.test('https://example.com/file')).toBe(false);
  });

  it('保存した PDF のとき、.pdf で終わる file の URL だけ移す', () => {
    const rule = rules.find((r) => r.condition.regexFilter?.startsWith('^file://') === true);
    const pattern = new RegExp(rule?.condition.regexFilter ?? '(?!)', 'u');
    expect(pattern.test('file:///C:/docs/a.pdf')).toBe(true);
    expect(pattern.test('file:///C:/docs/a.txt')).toBe(false);
    expect(rule?.action.type).toBe('redirect');
  });

  it('attachment 付きのとき、枠の中と「=download」のリンクは移さない決まりが、移す決まりより先にある', () => {
    const allowIndexes = rules.flatMap((rule, index) =>
      rule.action.type === 'allow' ? [index] : [],
    );
    const firstHeaderRedirect = rules.findIndex(
      (rule) => rule.action.type === 'redirect' && rule.condition.responseHeaders !== undefined,
    );
    expect(allowIndexes).toHaveLength(2);
    for (const index of allowIndexes) {
      expect(index).toBeLessThan(firstHeaderRedirect);
      expect(rules[index]?.condition.responseHeaders).toEqual([
        { header: 'content-disposition', values: ['attachment*'] },
      ]);
    }
    const [inFrame, download] = allowIndexes.map((index) => rules[index]);
    expect(inFrame?.condition.resourceTypes).toEqual(['sub_frame']);
    expect(download?.condition.urlFilter).toBe('=download');
    expect(download?.condition.resourceTypes).toEqual(['main_frame']);
  });
});
