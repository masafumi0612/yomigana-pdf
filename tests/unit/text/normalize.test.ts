import { describe, expect, it } from 'vitest';

import { normalizeForAnalysis } from '@/text/normalize';

describe('normalizeForAnalysis', () => {
  it.each([
    ['部首の字 ⽇', '⽇本', '日本', [0, 1, 2]],
    ['縦書きの記号 ︵︶', '︵日︶', '(日)', [0, 1, 2, 3]],
    ['全角の英数字', 'Ａ１', 'A1', [0, 1, 2]],
    ['1字が4字に広がる ㍿', 'A㍿B', 'A株式会社B', [0, 1, 1, 1, 1, 2, 3]],
    ['半角の片仮名と濁点 ｶﾞ', 'ｶﾞｷ', 'ガキ', [0, 2, 3]],
    ['2つの番号で表す字 𠮟', '𠮟る', '𠮟る', [0, 1, 2, 3]],
    ['空の文字列', '', '', [0]],
  ])('%s のとき、正規化した文字列と、もとの位置になる', (_name, text, expected, toOriginal) => {
    expect(normalizeForAnalysis(text)).toEqual({ text: expected, toOriginal });
  });

  it('変わる字がないとき、位置が1つずつ対応する', () => {
    const { toOriginal } = normalizeForAnalysis('漢字とかな');
    expect(toOriginal).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
