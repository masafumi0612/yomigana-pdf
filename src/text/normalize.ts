// 形態素解析に渡す前に、字の形をそろえる（NFKC）。PDF の文字そのものは変えない

/** 正規化した文字列と、もとの文字列の位置との対応 */
export interface NormalizedText {
  /** NFKC で正規化した文字列（解析だけに使う） */
  readonly text: string;
  /**
   * text の位置（UTF-16 の番号）から、もとの文字列の位置を引く。
   * 長さは text.length + 1 で、最後はもとの文字列の長さ（語の終わりを引くため）。
   * 1字が何字にも広がったとき（㍿ → 株式会社）や、何字かが1字にまとまったとき（ｶﾞ → ガ）は、
   * どの位置も、もとの字の頭を指す
   */
  readonly toOriginal: readonly number[];
}

const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/**
 * 解析のために文字列を NFKC で正規化する（部首の字 ⽇ → 日、半角の片仮名 ｶﾞ → ガ、全角の英数字など）。
 * 字の境目（書記素）ごとに正規化して、正規化したあとの位置から、もとの位置を引けるようにする。
 * 濁点の付いた字（ｶﾞ）や、2つの番号で表す字（𠮟）は、1つの書記素として扱う。
 * @param text もとの文字列（PDF から取り出した文字）
 * @returns 正規化した文字列と、位置の対応
 */
export function normalizeForAnalysis(text: string): NormalizedText {
  let normalized = '';
  const toOriginal: number[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const chunk = segment.normalize('NFKC');
    const isUnchanged = chunk === segment;
    for (let offset = 0; offset < chunk.length; offset += 1) {
      // 形が変わった字は、ルビをもとの字全体に付けるため、どの位置も字の頭を指す
      toOriginal.push(isUnchanged ? index + offset : index);
    }
    normalized += chunk;
  }
  toOriginal.push(text.length);
  return { text: normalized, toOriginal };
}
