/** 片仮名と、同じ音の平仮名の、文字の番号の差（ア U+30A2 − あ U+3042） */
const KATAKANA_OFFSET = 0x60;

/**
 * 片仮名を平仮名に直す。長音（ー）や平仮名にない字（ヷ など）、片仮名でない字はそのまま。
 * @param text 片仮名を含む文字列（例：イッポン）
 * @returns 平仮名にした文字列（例：いっぽん）
 */
export function toHiragana(text: string): string {
  return text.replaceAll(/[ァ-ヶ]/gu, (char) =>
    String.fromCodePoint(char.charCodeAt(0) - KATAKANA_OFFSET),
  );
}
