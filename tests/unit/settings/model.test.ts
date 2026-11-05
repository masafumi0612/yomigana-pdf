import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, RUBY_COLORS, RUBY_SIZE_RATIOS, SETTING_KEYS } from '@/settings/model';

/** WCAG 2.2 AA で、ふつうの大きさの字に要る色の差 */
const MIN_CONTRAST = 4.5;

/**
 * WCAG の相対輝度を出す。
 * @param hex `#rrggbb` の色
 * @returns 相対輝度（0〜1）
 */
function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 白い紙に対する色の差を出す。
 * @param hex `#rrggbb` の色
 * @returns 色の差（1〜21）
 */
function contrastOnWhite(hex: string): number {
  return (1 + 0.05) / (relativeLuminance(hex) + 0.05);
}

describe('DEFAULT_SETTINGS', () => {
  it('何も選んでいないとき、自動で開かず・すべての漢字に・中の大きさの黒で、帯なしになる', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      autoRedirect: false,
      level: 'all',
      rubyUnit: 'unlearned-char',
      rubyStyle: { size: 'm', color: 'ink', hasBand: false },
    });
  });

  it('既定の項目と、設定のキーの並びが揃う', () => {
    expect(Object.keys(DEFAULT_SETTINGS).toSorted()).toEqual([...SETTING_KEYS].toSorted());
  });
});

describe('RUBY_SIZE_RATIOS', () => {
  it('小・中・大のとき、親字の 0.42・0.5・0.6 倍になる', () => {
    expect(RUBY_SIZE_RATIOS).toEqual({ s: 0.42, m: 0.5, l: 0.6 });
  });
});

describe('RUBY_COLORS', () => {
  it('黒のとき、#000000 になる', () => {
    expect(RUBY_COLORS.ink).toBe('#000000');
  });

  it.each(Object.entries(RUBY_COLORS))(
    '%s のとき、白い紙に対して 4.5:1 以上の差がある',
    (_name, color) => {
      expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    },
  );
});
