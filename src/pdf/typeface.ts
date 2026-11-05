// PDF のフォントが明朝（serif）かゴシック（sans-serif）かを見分ける。
// ルビのフォントを、紙面の字に合わせるために使う。
import type { PdfTextStyle } from './types';

/** ゴシックを示す名前の一部（大文字小文字は区別しない）。「sans-serif」の中の「serif」を明朝と取り違えないよう、先に見る */
const SANS_HINT = /sans|gothic|ゴシック|ゴジック|kakugo|shingo|arial|helvetica/i;
/** 明朝を示す名前の一部 */
const SERIF_HINT = /serif|mincho|明朝|ryumin|heiseimin|ming|song|times|georgia|garamond/i;
/** フォントの名前の頭につく、部分集合の印（例：ABCDEF+） */
const SUBSET_PREFIX = /^[A-Z]{6}\+/;

/**
 * 明朝か。フォント自身の名前を先に見て、なければ pdf.js が出す family（フォントの印から決まる）を見る。
 * 見分けられないときはゴシック（false）にする。
 * @param style getTextContent() の styles の、このフォントの項目
 * @param fontName フォント自身の名前（取れたときだけ。例：ABCDEF+NotoSerifJP-Regular）
 * @returns 明朝なら true
 */
export function isSerifFont(
  style: PdfTextStyle | undefined,
  fontName: string | undefined,
): boolean {
  const name = fontName?.replace(SUBSET_PREFIX, '') ?? '';
  if (SANS_HINT.test(name)) return false;
  if (SERIF_HINT.test(name)) return true;
  const family = style?.fontFamily ?? '';
  return !SANS_HINT.test(family) && SERIF_HINT.test(family);
}
