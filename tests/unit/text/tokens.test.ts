import type { IpadicFeatures } from '@patdx/kuromoji';
import { describe, expect, it } from 'vitest';

import { toTokens } from '@/text/tokens';

/**
 * テスト用の kuromoji の語を作る。
 * @param fields 変えるところ
 * @returns kuromoji の語
 */
function feature(fields: Partial<IpadicFeatures>): IpadicFeatures {
  return {
    word_id: 0,
    word_type: 'KNOWN',
    word_position: 1,
    surface_form: '',
    pos: '*',
    pos_detail_1: '*',
    pos_detail_2: '*',
    pos_detail_3: '*',
    conjugated_type: '*',
    conjugated_form: '*',
    basic_form: '*',
    ...fields,
  };
}

describe('toTokens', () => {
  it('書き方・読み・品詞を移し、値のない * を空の文字列にする', () => {
    const features = [
      feature({
        surface_form: '本',
        reading: 'ホン',
        pos: '名詞',
        pos_detail_1: '接尾',
        pos_detail_2: '助数詞',
      }),
    ];
    expect(toTokens(features)).toEqual([
      { surface: '本', reading: 'ホン', pos: '名詞', posDetails: ['接尾', '助数詞', ''] },
    ]);
  });

  it('辞書にない語は、読みを空の文字列にする', () => {
    const features = [feature({ surface_form: '檸', word_type: 'UNKNOWN', pos: '名詞' })];
    expect(toTokens(features)).toEqual([
      { surface: '檸', reading: '', pos: '名詞', posDetails: ['', '', ''] },
    ]);
  });
});
