import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from '@/settings/model';
import { parseSettings } from '@/settings/validate';

const STORED: Settings = {
  autoRedirect: true,
  level: 'g3',
  rubyUnit: 'unlearned-char',
  rubyStyle: { size: 'l', color: 'orange', hasBand: true },
};

describe('parseSettings', () => {
  it('何も保存していないとき、既定になる', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('形の合った値のとき、その値になる', () => {
    expect(parseSettings({ ...STORED })).toEqual(STORED);
  });

  it.each([
    { key: 'autoRedirect', value: 'yes' },
    { key: 'level', value: 'g7' },
    { key: 'rubyUnit', value: 'word' },
    { key: 'rubyStyle', value: ['l', 'orange', true] },
    { key: 'rubyStyle', value: 'l' },
  ] as const)('$key が $value のとき、その項目だけ既定になる', ({ key, value }) => {
    expect(parseSettings({ ...STORED, [key]: value })).toEqual({
      ...STORED,
      [key]: DEFAULT_SETTINGS[key],
    });
  });

  it.each([
    { key: 'size', value: 'xl' },
    { key: 'color', value: 'red' },
    { key: 'color', value: 'toString' },
    { key: 'hasBand', value: 1 },
  ] as const)('ルビの見た目の $key が $value のとき、その項目だけ既定になる', ({ key, value }) => {
    const settings = parseSettings({ ...STORED, rubyStyle: { ...STORED.rubyStyle, [key]: value } });

    expect(settings.rubyStyle).toEqual({
      ...STORED.rubyStyle,
      [key]: DEFAULT_SETTINGS.rubyStyle[key],
    });
  });
});
