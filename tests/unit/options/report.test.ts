import { describe, expect, it } from 'vitest';

import type { ErrorRecord } from '@/log';
import { browserVersionOf, buildReport } from '@/options/report';

/** Chrome の User-Agent（版は大きい番号だけ） */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 報告に入れる1件のエラー */
function errorOf(message: string, time = '2026-11-06T01:00:00.000Z'): ErrorRecord {
  return { time, scope: 'viewer', message };
}

describe('browserVersionOf', () => {
  it('細かい版の一覧に Google Chrome があるとき、その版を使う', () => {
    const brands = [
      { brand: 'Not_A Brand', version: '24.0.0.0' },
      { brand: 'Chromium', version: '131.0.6778.85' },
      { brand: 'Google Chrome', version: '131.0.6778.85' },
    ];

    expect(browserVersionOf(CHROME_UA, brands)).toBe('Google Chrome 131.0.6778.85');
  });

  it('一覧に Chromium しかないとき、Chromium の版を使う', () => {
    expect(browserVersionOf(CHROME_UA, [{ brand: 'Chromium', version: '131.0.6778.85' }])).toBe(
      'Chromium 131.0.6778.85',
    );
  });

  it('細かい版が取れないとき、User-Agent の版を使う', () => {
    expect(browserVersionOf(CHROME_UA)).toBe('Chrome 131.0.0.0');
  });

  it('User-Agent に Chrome の版がないとき、不明にする', () => {
    expect(browserVersionOf('Mozilla/5.0')).toBe('不明');
  });
});

describe('buildReport', () => {
  it('エラーがないとき、版と「なし」だけを入れる', () => {
    expect(
      buildReport({ extensionVersion: '0.1.0', browserVersion: 'Chrome 131.0.0.0', errors: [] }),
    ).toBe('よみがなPDF 0.1.0\nブラウザ：Chrome 131.0.0.0\n直近のエラー：なし');
  });

  it('エラーがあるとき、新しい順に時刻・部品・文を入れる', () => {
    const text = buildReport({
      extensionVersion: '0.1.0',
      browserVersion: 'Chrome 131.0.0.0',
      errors: [
        errorOf('古いエラー', '2026-11-06T01:00:00.000Z'),
        errorOf('新しいエラー', '2026-11-06T02:00:00.000Z'),
      ],
    });

    expect(text.split('\n').slice(2)).toEqual([
      '直近のエラー（新しい順）：',
      '- 2026-11-06T02:00:00.000Z [viewer] 新しいエラー',
      '- 2026-11-06T01:00:00.000Z [viewer] 古いエラー',
    ]);
  });

  it('エラーの文に URL が混じっていても、URL を入れない', () => {
    const text = buildReport({
      extensionVersion: '0.1.0',
      browserVersion: 'Chrome 131.0.0.0',
      errors: [
        errorOf('読めませんでした：Missing PDF "https://example.com/school/print.pdf".'),
        errorOf('開けませんでした：file:///C:/Users/me/doc.pdf'),
        errorOf('blob:chrome-extension://abc/1234#名簿.pdf を読めません'),
      ],
    });

    expect(text).not.toMatch(/example\.com|file:|blob:|chrome-extension:|\.pdf/u);
  });
});
