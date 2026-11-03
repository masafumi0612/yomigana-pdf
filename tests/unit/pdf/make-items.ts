// テストで使う、pdf.js の文字の片の作り方。字の幅と高さは、字の大きさと同じにする。
import type { PdfTextContent, PdfTextItem } from '@/pdf/types';

/** 字の大きさ（決めないとき） */
export const SIZE = 10;

/**
 * 横書きの片を作る。
 * @param str 片の文字
 * @param x 左の端
 * @param y 基準線
 * @param size 字の大きさ
 * @returns 片
 */
export function horizontalItem(str: string, x: number, y: number, size = SIZE): PdfTextItem {
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: size * Array.from(str).length,
    height: size,
    fontName: 'horizontal',
  };
}

/**
 * 縦書きの印（dir が ttb）のある片を作る。
 * @param str 片の文字
 * @param x 列の中心
 * @param y 上の端
 * @param size 字の大きさ
 * @returns 片
 */
export function verticalItem(str: string, x: number, y: number, size = SIZE): PdfTextItem {
  return {
    str,
    dir: 'ttb',
    transform: [size, 0, 0, size, x, y],
    width: size,
    height: size * Array.from(str).length,
    fontName: 'vertical',
  };
}

/**
 * 縦書きの印のない縦書き（Word の PDF のように、1字ずつの横書きの片が真下へ並ぶ）の片を作る。
 * @param text 列の文字
 * @param x 左の端
 * @param y 最初の字の基準線
 * @param size 字の大きさ
 * @returns 1字ずつの片
 */
export function unmarkedColumn(text: string, x: number, y: number, size = SIZE): PdfTextItem[] {
  return Array.from(text).map((ch, index) => horizontalItem(ch, x, y - index * size, size));
}

/**
 * 横書きの行を、行ごとの片にして作る。
 * @param lines 行の文字
 * @param x 左の端
 * @param y 最初の行の基準線
 * @param pitch 行の送り
 * @param size 字の大きさ
 * @returns 行ごとの片
 */
export function horizontalLines(
  lines: readonly string[],
  x: number,
  y: number,
  pitch: number,
  size = SIZE,
): PdfTextItem[] {
  return lines.map((line, index) => horizontalItem(line, x, y - index * pitch, size));
}

/**
 * 縦書きの列を、列ごとの片にして作る（右の列から）。
 * @param columns 列の文字
 * @param x 最初の（右の）列の中心
 * @param y 上の端
 * @param pitch 列の送り
 * @param size 字の大きさ
 * @returns 列ごとの片
 */
export function verticalColumns(
  columns: readonly string[],
  x: number,
  y: number,
  pitch: number,
  size = SIZE,
): PdfTextItem[] {
  return columns.map((column, index) => verticalItem(column, x - index * pitch, y, size));
}

/**
 * getTextContent() の結果の形にする。縦書きの片は、縦書きのフォントを使う。
 * @param items 片
 * @returns getTextContent() の結果の形
 */
export function contentOf(items: readonly PdfTextItem[]): PdfTextContent {
  return { items, styles: { horizontal: {}, vertical: { vertical: true } } };
}

/**
 * 値があることを確かめて返す（テストの前提が崩れたら、そこで止める）。
 * @param value 値
 * @returns 値
 */
export function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('値がない');
  return value;
}
