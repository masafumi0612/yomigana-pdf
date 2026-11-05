import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from '@/settings/model';
import { nearestFirst, settingsChange } from '@/viewer/settings-change';

/**
 * 既定の設定のルビの見た目だけを変えたものを作る。
 * @param style 変える見た目
 * @returns 設定
 */
function withStyle(style: Partial<Settings['rubyStyle']>): Settings {
  return { ...DEFAULT_SETTINGS, rubyStyle: { ...DEFAULT_SETTINGS.rubyStyle, ...style } };
}

describe('settingsChange', () => {
  it('段階が変わったとき、読み直すことになる', () => {
    expect(settingsChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, level: 'g3' })).toEqual({
      isLevelChanged: true,
      isSizeChanged: false,
    });
  });

  it('ルビの大きさが変わったとき、読み直さずに置き直すことになる', () => {
    expect(settingsChange(DEFAULT_SETTINGS, withStyle({ size: 'l' }))).toEqual({
      isLevelChanged: false,
      isSizeChanged: true,
    });
  });

  it('色と帯だけが変わったとき、読み直しも置き直しもしない', () => {
    expect(settingsChange(DEFAULT_SETTINGS, withStyle({ color: 'blue', hasBand: true }))).toEqual({
      isLevelChanged: false,
      isSizeChanged: false,
    });
  });

  it('ルビに関わらない設定だけが変わったとき、読み直しも置き直しもしない', () => {
    expect(settingsChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, autoRedirect: true })).toEqual({
      isLevelChanged: false,
      isSizeChanged: false,
    });
  });

  it('段階と大きさが一緒に変わったとき、両方をやり直すことになる', () => {
    expect(
      settingsChange(DEFAULT_SETTINGS, { ...withStyle({ size: 's' }), level: 'joyo' }),
    ).toEqual({ isLevelChanged: true, isSizeChanged: true });
  });
});

describe('nearestFirst', () => {
  it('ページを並べたとき、今のページに近い順になる', () => {
    expect(nearestFirst([1, 2, 3, 4, 5, 6], 5)).toEqual([5, 4, 6, 3, 2, 1]);
  });

  it('近さが同じページがあるとき、番号の小さいページが先になる', () => {
    expect(nearestFirst([4, 2], 3)).toEqual([2, 4]);
  });

  it('並べたとき、渡した並びは変えない', () => {
    const pages = [3, 1, 2];
    nearestFirst(pages, 1);
    expect(pages).toEqual([3, 1, 2]);
  });
});
