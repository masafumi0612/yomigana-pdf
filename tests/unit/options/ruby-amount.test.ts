import { describe, expect, it } from 'vitest';

import { ELEMENTARY_LEVELS, levelChoiceText, MIDDLE_LEVELS } from '@/options/ruby-amount';
import { KANJI_TIERS } from '@/text/kanji-data';
import type { Level } from '@/text/types';

import { localeMessage } from '../../helpers/locale-message';

describe('levelChoiceText', () => {
  it.each<[Level, string, string]>([
    ['all', 'なし', 'すべての漢字にルビ'],
    ['g1', '1年まで', '80字'],
    ['g3', '3年まで', '440字'],
    ['g6', '6年まで', '1,026字'],
    ['m1', '中1まで（目安）', '1,376字'],
    ['m2', '中2まで（目安）', '1,776字'],
    ['joyo', '常用漢字すべて', '2,136字'],
  ])('段階が %s のとき、名前は「%s」、説明は「%s」になる', (level, name, note) => {
    expect(levelChoiceText(level, localeMessage)).toEqual({ name, note });
  });
});

describe('ELEMENTARY_LEVELS と MIDDLE_LEVELS', () => {
  it('つなげたとき、「なし」のあとにすべての段階が習う順に並ぶ', () => {
    expect([...ELEMENTARY_LEVELS, ...MIDDLE_LEVELS]).toEqual(['all', ...KANJI_TIERS]);
  });
});
