// kuromoji が出す語を、読みの処理で使う形（Token）にする
import type { IpadicFeatures } from 'kuromoji';

import type { Token } from './types';

/** IPADIC で「値がない」ことを表す印 */
const NO_VALUE = '*';

/**
 * kuromoji の語の並びを、読みの処理で使う形にする。
 * @param features kuromoji（IPADIC）が出した語の並び
 * @returns 読みの処理で使う語の並び。書き方をつなぐと、解析した文と同じになる
 */
export function toTokens(features: readonly IpadicFeatures[]): Token[] {
  return features.map((feature) => ({
    surface: feature.surface_form,
    reading: valueOf(feature.reading),
    pos: valueOf(feature.pos),
    posDetails: [feature.pos_detail_1, feature.pos_detail_2, feature.pos_detail_3].map(valueOf),
  }));
}

/**
 * IPADIC の1つの値を、値がなければ空の文字列にする。
 * @param value 値。辞書にない語では読みなどが undefined になる
 * @returns 値。値がない（* か undefined）なら空の文字列
 */
function valueOf(value: string | undefined): string {
  return value === undefined || value === NO_VALUE ? '' : value;
}
