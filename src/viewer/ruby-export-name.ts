// ルビ付き PDF の名前（保存するファイル名と PDF の題名）と、ルビなしのページの並べ方を決める。画面は触らない

/** ルビ付き PDF の名前の文言 */
export interface RubyPdfNameText {
  /**
   * もとの名前から、ルビ付き PDF の名前を作る（拡張子は付けない）
   * @param name もとの名前（拡張子を除き、使えない字を置きかえたもの）
   * @returns ルビ付き PDF の名前
   */
  readonly withName: (name: string) => string;
  /** もとの名前がないときの名前（拡張子は付けない） */
  readonly fallback: string;
}

/** ルビ付き PDF の名前 */
export interface RubyPdfName {
  /** PDF の題名（/Title）。拡張子は付けない */
  readonly title: string;
  /** 保存するファイル名 */
  readonly fileName: string;
}

/** ルビなしのページを並べた文字 */
export interface PageListText {
  /** 「・」でつないだページ番号 */
  readonly list: string;
  /** 多すぎて、初めのいくつかだけ並べたなら true */
  readonly isTruncated: boolean;
}

/** PDF の拡張子（大文字・小文字を問わない） */
const PDF_EXTENSION = /\.pdf$/iu;
/** ファイル名に使えない字（Windows で使えない字と、制御文字） */
const UNSAFE_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;
/** 使えない字の代わりに入れる字 */
const REPLACEMENT = '_';
/** 名前の頭と後ろの、空白と点（Windows は名前の後ろの点と空白を落とす） */
const EDGE_CHARS = /^[\s.]+|[\s.]+$/gu;
/** もとの名前から使う字の数の上限。ファイル名の長さの上限（255）に、後ろに足す文字を入れても収まるように */
const MAX_NAME_LENGTH = 100;
/** ルビなしのページを並べる数の上限 */
const MAX_LISTED_PAGES = 10;
/** ページ番号をつなぐ字 */
const PAGE_SEPARATOR = '・';

/**
 * もとの PDF の名前から、ルビ付き PDF の名前を作る。
 * 拡張子 .pdf を除き、ファイル名に使えない字を「_」に置きかえ、長すぎる名前は切りつめる。
 * @param sourceName もとの PDF の名前（URL の最後や、開いたファイルの名前）。分からなければ undefined
 * @param text 名前の文言
 * @returns PDF の題名と、保存するファイル名
 */
export function rubyPdfName(sourceName: string | undefined, text: RubyPdfNameText): RubyPdfName {
  const name = cleanName(sourceName ?? '');
  const title = name === '' ? text.fallback : text.withName(name);
  return { title, fileName: `${title}.pdf` };
}

/**
 * ルビなしのページを、「・」でつないで並べる。多いときは初めのいくつかだけにする。
 * @param pages ページ番号（小さい順）
 * @returns 並べた文字
 */
export function pageListText(pages: readonly number[]): PageListText {
  return {
    list: pages.slice(0, MAX_LISTED_PAGES).map(String).join(PAGE_SEPARATOR),
    isTruncated: pages.length > MAX_LISTED_PAGES,
  };
}

/**
 * 名前から拡張子を除き、ファイル名に使える形にする。
 * @param name もとの名前
 * @returns 使える形の名前。残る字がなければ空の文字列
 */
function cleanName(name: string): string {
  const replaced = name
    .replace(PDF_EXTENSION, '')
    .replace(UNSAFE_CHARS, REPLACEMENT)
    .replace(EDGE_CHARS, '');
  // サロゲートペアの字を途中で切らないよう、字ごとに数える
  return Array.from(replaced).slice(0, MAX_NAME_LENGTH).join('').replace(EDGE_CHARS, '');
}
