// 長方形（PDF の座標）の計算。
import type { Rect } from './types';

/**
 * いくつかの長方形をすべて囲む長方形を作る。
 * @param rects 長方形（1つ以上）
 * @returns 囲む長方形
 */
export function unionRect(rects: readonly Rect[]): Rect {
  return {
    x1: Math.min(...rects.map((rect) => rect.x1)),
    y1: Math.min(...rects.map((rect) => rect.y1)),
    x2: Math.max(...rects.map((rect) => rect.x2)),
    y2: Math.max(...rects.map((rect) => rect.y2)),
  };
}

/**
 * 横の真ん中の位置。
 * @param rect 長方形
 * @returns x の真ん中
 */
export function centerX(rect: Rect): number {
  return (rect.x1 + rect.x2) / 2;
}

/**
 * 縦の真ん中の位置。
 * @param rect 長方形
 * @returns y の真ん中
 */
export function centerY(rect: Rect): number {
  return (rect.y1 + rect.y2) / 2;
}

/**
 * 2つの区間が重なる長さ。
 * @param lo1 1つめの小さい端
 * @param hi1 1つめの大きい端
 * @param lo2 2つめの小さい端
 * @param hi2 2つめの大きい端
 * @returns 重なる長さ（重ならなければ 0 以下）
 */
export function overlapLength(lo1: number, hi1: number, lo2: number, hi2: number): number {
  return Math.min(hi1, hi2) - Math.max(lo1, lo2);
}
