// 座標の変換（PDF の座標・画面の座標・Canvas の画素のあいだ）に使う、アフィン変換の行列の計算

/** 2次元の点 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** アフィン変換の行列 [a, b, c, d, e, f]。x' = a·x + c·y + e、y' = b·x + d·y + f（pdf.js と同じ並び） */
export type Matrix = readonly [number, number, number, number, number, number];

/**
 * 2つの変換を続けてかける行列を作る。
 * @param outer あとからかける変換
 * @param inner 先にかける変換
 * @returns inner のあとに outer をかける変換
 */
export function multiplyMatrix(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * 逆の変換を作る。
 * @param matrix 変換
 * @returns 逆の変換。つぶれた変換（大きさが 0）で逆がないときは undefined
 */
export function invertMatrix(matrix: Matrix): Matrix | undefined {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (determinant === 0) return undefined;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

/**
 * 点に変換をかける。
 * @param matrix 変換
 * @param point 点
 * @returns 変換した点
 */
export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/**
 * pdf.js の変換の配列を、行列の形にする。
 * @param values 6つの数（pdf.js の viewport.transform など）
 * @returns 行列。数が足りないところは単位行列の値にする
 */
export function toMatrix(values: readonly number[]): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return [a, b, c, d, e, f];
}
