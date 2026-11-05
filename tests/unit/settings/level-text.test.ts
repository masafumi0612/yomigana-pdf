import { describe, expect, it } from 'vitest';

import { levelAmountText } from '@/settings/level-text';
import type { Level } from '@/text/types';

import { localeMessage } from '../../helpers/locale-message';

describe('levelAmountText', () => {
  it.each<[Level, string]>([
    ['all', 'すべての漢字に付ける'],
    ['g1', '1年までの漢字には付けない'],
    ['g2', '2年までの漢字には付けない'],
    ['g3', '3年までの漢字には付けない'],
    ['g4', '4年までの漢字には付けない'],
    ['g5', '5年までの漢字には付けない'],
    ['g6', '6年までの漢字には付けない'],
    ['m1', '中1までの漢字には付けない'],
    ['m2', '中2までの漢字には付けない'],
    ['joyo', '常用漢字には付けない'],
  ])('段階が %s のとき、「%s」になる', (level, expected) => {
    expect(levelAmountText(level, localeMessage)).toBe(expected);
  });
});
