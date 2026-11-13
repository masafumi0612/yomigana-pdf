// ページの回転（/Rotate）のある PDF の座標を、表示の向きの座標に直す。
// pdf.js の文字の片と Canvas の位置は回転の前の座標なので、回したページでは字が横倒しに見える。
// 文の組み立てとルビの置き場所は、横書きは左から・縦書きは上からという向きを前提にしているので、
// 表示の向きの座標（左下が原点、y は上向き、回転なし）にそろえて扱う。
import type { PdfTextContent } from '@/pdf/types';

import type { PageFrame } from './ruby-layout';
import { invertMatrix, type Matrix, multiplyMatrix } from './transform';

/** 回転と箱の分かるページ */
export interface RotatedPage {
  /** ページの回転（0・90・180・270） */
  readonly rotate: number;
  /** ページの箱（PDF の座標） */
  readonly view: readonly number[];
}

/** 回っていると見なす、変換の行列の傾きの下限 */
const SIDEWAYS_EPSILON = 0.01;
/** ページごとの、字が横倒しに入っているか（getTextContent() を見たあとで分かる） */
const storedSideways = new WeakMap<object, boolean>();

/** 回転を 0・90・180・270 にそろえる */
const FULL_TURN = 360;
/** 90 度の回転 */
const QUARTER_TURN = 90;
/** 180 度の回転 */
const HALF_TURN = 180;
/** 270 度の回転 */
const THREE_QUARTER_TURN = 270;

/**
 * ページの字が横倒し（か逆さ）に入っているかを覚える。
 * /Rotate のあるページのふつうの作りは、字を横倒しか逆さに入れ、ページごと回して正しい向きに見せる。
 * 字がまっすぐ入っているページは、表示では字が横倒しになる。これは表示の向きに直さず、今までどおり扱う。
 * @param page ページ
 * @param content getTextContent() の結果
 */
export function noteTextRotation(page: object, content: PdfTextContent): void {
  let sideways = 0;
  let straight = 0;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const [a = 0, b = 0] = item.transform;
    // b が 0 でなければ横倒し、a が負なら逆さ（180 度）
    if (Math.abs(b) > SIDEWAYS_EPSILON || a < 0) sideways += item.str.length;
    else straight += item.str.length;
  }
  storedSideways.set(page, sideways > straight);
}

/**
 * 表示の向きに直すときに使うページ。字がまっすぐ入っているページは、回転がないものとして扱う。
 * @param page ページ
 * @returns 回転と箱
 */
export function textPage(page: RotatedPage): RotatedPage {
  return storedSideways.get(page) === true ? page : { rotate: 0, view: page.view };
}

/**
 * 回転を 0 以上 360 未満にする。
 * @param rotate 回転
 * @returns 0 以上 360 未満の回転
 */
function normalized(rotate: number): number {
  return ((rotate % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/**
 * PDF の座標から、表示の向きの座標への変換。
 * @param page ページ
 * @returns 変換。回転がなければ undefined
 */
export function uprightMatrix(page: RotatedPage): Matrix | undefined {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
  switch (normalized(page.rotate)) {
    case QUARTER_TURN: {
      return [0, -1, 1, 0, -y1, x2];
    }
    case HALF_TURN: {
      return [-1, 0, 0, -1, x2, y2];
    }
    case THREE_QUARTER_TURN: {
      return [0, 1, -1, 0, y2, -x1];
    }
    default: {
      return undefined;
    }
  }
}

/**
 * 表示の向きの座標から、PDF の座標への変換。
 * @param page ページ
 * @returns 変換。回転がなければ undefined
 */
export function fromUprightMatrix(page: RotatedPage): Matrix | undefined {
  const matrix = uprightMatrix(page);
  return matrix === undefined ? undefined : invertMatrix(matrix);
}

/**
 * ページの箱を、表示の向きの座標で出す。
 * @param page ページ
 * @returns ページの箱
 */
export function uprightFrame(page: RotatedPage): PageFrame {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
  const width = x2 - x1;
  const height = y2 - y1;
  const rotate = normalized(page.rotate);
  if (rotate === 0) return { pageX: x1, pageY: y1, pageWidth: width, pageHeight: height };
  const isSideways = rotate % HALF_TURN !== 0;
  return {
    pageX: 0,
    pageY: 0,
    pageWidth: isSideways ? height : width,
    pageHeight: isSideways ? width : height,
  };
}

/**
 * 文字の片の位置を、表示の向きの座標に直す。
 * @param content getTextContent() の結果
 * @param page ページ
 * @returns 直した結果。回転がなければ、そのまま
 */
export function uprightContent<T extends PdfTextContent>(content: T, page: RotatedPage): T {
  const matrix = uprightMatrix(page);
  if (matrix === undefined) return content;
  return {
    ...content,
    items: content.items.map((item) => {
      if (!('str' in item)) return item;
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
      return { ...item, transform: [...multiplyMatrix(matrix, [a, b, c, d, e, f])] };
    }),
  };
}

/**
 * ある座標への変換の前に、表示の向きの座標から PDF の座標への変換をはさむ。
 * @param toTarget PDF の座標からの変換
 * @param page ページ
 * @returns 表示の向きの座標からの変換
 */
export function fromUpright(toTarget: Matrix, page: RotatedPage): Matrix {
  const back = fromUprightMatrix(page);
  return back === undefined ? toTarget : multiplyMatrix(toTarget, back);
}

/**
 * Canvas などの座標から PDF の座標への変換のあとに、表示の向きの座標への変換をつなぐ。
 * @param toPdf PDF の座標への変換
 * @param page ページ
 * @returns 表示の向きの座標への変換
 */
export function toUpright(toPdf: Matrix, page: RotatedPage): Matrix {
  const matrix = uprightMatrix(page);
  return matrix === undefined ? toPdf : multiplyMatrix(matrix, toPdf);
}
