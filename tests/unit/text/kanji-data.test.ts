import { describe, expect, it } from 'vitest';

import kanjiJson from '@/text/data/kanji.json';
import {
  countKanjiWithin,
  FUHYO_WORDS,
  getKanjiInfo,
  getKanjiTier,
  isJoyo,
  isTierWithin,
  KANJI_TIERS,
} from '@/text/kanji-data';

/** 常用漢字表が認める許容字体のうち、文字の番号が別のもの（正字体, 許容字体） */
const ALLOWED_FORMS: readonly (readonly [string, string])[] = [
  ['𠮟', '叱'],
  ['塡', '填'],
  ['剝', '剥'],
  ['頰', '頬'],
];

const allowedChars = new Set(ALLOWED_FORMS.map(([, allowed]) => allowed));
const entries = Object.entries(kanjiJson.kanji);
/** 正字体だけの段階（許容字体は数えない） */
const standardTiers = entries
  .filter(([char]) => !allowedChars.has(char))
  .map(([, entry]) => entry.tier);

describe('kanji.json', () => {
  it('字の数を数えたとき、常用漢字 2,136字と許容字体 4字で 2,140字になる', () => {
    expect(entries).toHaveLength(2140);
  });

  it.each([
    ['g1', 80],
    ['g2', 160],
    ['g3', 200],
    ['g4', 202],
    ['g5', 193],
    ['g6', 191],
    ['m1', 350],
    ['m2', 400],
    ['joyo', 360],
  ])('段階 %s の正字体を数えたとき、%i 字になる', (tier, count) => {
    expect(standardTiers.filter((t) => t === tier)).toHaveLength(count);
  });

  it('すべての字の段階を見たとき、決まった段階のどれかになる', () => {
    const tiers = entries.map(([, entry]) => entry.tier);
    expect(tiers.every((t) => (KANJI_TIERS as readonly string[]).includes(t))).toBe(true);
  });
});

describe('getKanjiInfo', () => {
  it('常用漢字「鑑」のとき、音訓が常用漢字表のとおりになる', () => {
    expect(getKanjiInfo('鑑')).toMatchObject({ on: ['カン'], kun: ['かんが.みる'] });
  });

  it('常用漢字でない字のとき、undefined になる', () => {
    expect(getKanjiInfo('鰯')).toBeUndefined();
  });

  it('Object の名前（constructor）のとき、undefined になる', () => {
    expect(getKanjiInfo('constructor')).toBeUndefined();
  });

  it.each(ALLOWED_FORMS)('許容字体 %s／%s のとき、正字体と同じ情報になる', (standard, allowed) => {
    expect(getKanjiInfo(allowed)).toEqual(getKanjiInfo(standard));
  });
});

describe('isJoyo', () => {
  it.each(ALLOWED_FORMS.map(([, allowed]) => allowed))(
    '許容字体 %s のとき、true になる',
    (char) => {
      expect(isJoyo(char)).toBe(true);
    },
  );

  it('平仮名のとき、false になる', () => {
    expect(isJoyo('あ')).toBe(false);
  });
});

describe('getKanjiTier', () => {
  it('1年の字「一」のとき、g1 になる', () => {
    expect(getKanjiTier('一')).toBe('g1');
  });

  it('6年の字「鋼」のとき、g6 になる', () => {
    expect(getKanjiTier('鋼')).toBe('g6');
  });

  it.each(ALLOWED_FORMS)('許容字体 %s／%s のとき、正字体と同じ段階になる', (standard, allowed) => {
    expect(getKanjiTier(allowed)).toBe(getKanjiTier(standard));
  });

  it('常用漢字でない字のとき、undefined になる', () => {
    expect(getKanjiTier('鰯')).toBeUndefined();
  });
});

describe('isTierWithin', () => {
  it('字の段階が習い終えた段階より前のとき、true になる', () => {
    expect(isTierWithin('g2', 'g3')).toBe(true);
  });

  it('字の段階が習い終えた段階と同じとき、true になる', () => {
    expect(isTierWithin('m1', 'm1')).toBe(true);
  });

  it('字の段階が習い終えた段階より後のとき、false になる', () => {
    expect(isTierWithin('m1', 'g6')).toBe(false);
  });
});

describe('countKanjiWithin', () => {
  it.each([
    ['g1', 80],
    ['g2', 240],
    ['g3', 440],
    ['g4', 642],
    ['g5', 835],
    ['g6', 1026],
    ['m1', 1376],
    ['m2', 1776],
  ] as const)('段階が %s のとき、それまでに習う字は %d 字になる', (level, count) => {
    expect(countKanjiWithin(level)).toBe(count);
  });

  it('常用漢字すべてのとき、許容字体を数えずに 2,136 字になる', () => {
    expect(countKanjiWithin('joyo')).toBe(2136);
  });
});

describe('FUHYO_WORDS', () => {
  it('付表の語を数えたとき、123 語になる', () => {
    expect(FUHYO_WORDS).toHaveLength(123);
  });

  it('「今日」を探したとき、読みは「きょう」になる', () => {
    expect(FUHYO_WORDS).toContainEqual({ word: '今日', reading: 'きょう' });
  });
});
