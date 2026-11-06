// 画面の上の位置から、そこにあるルビを探す。
// ルビの層は押す対象にしない（文字を選べるよう、押すのは下の文字の層）ので、要素ではなく位置で探す。
import type { PageViewport } from 'pdfjs-dist';

import type { RubyBox } from './ruby-layout';
import type { RubyPages, RubyPageView } from './ruby-pages';
import { type Box, toMatrix, transformBox } from './transform';

/** 画面の上の点（clientX・clientY と同じ座標） */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** 画面の上に置いたルビ */
export interface PlacedRuby {
  /** ページ番号（1 から） */
  readonly pageNumber: number;
  readonly box: RubyBox;
  /** ルビと親字を合わせた、画面の上の箱（clientX・clientY と同じ座標） */
  readonly rect: Box;
}

/** ルビの探し方 */
export interface RubySearch {
  /** 点からこれより離れたルビは選ばない（px）。0 なら、点がルビか親字の上にあるときだけ選ぶ */
  readonly maxDistance: number;
  /** この箱（画面の上）と重なるルビだけから選ぶ。見えている所だけから選ぶのに使う */
  readonly within?: Box;
}

/** ルビを探す部品の作り方 */
export interface RubyFinderOptions {
  /** ルビの層の部品（出しているページとルビを引く） */
  readonly pages: Pick<RubyPages, 'shownPages' | 'rubiesOf'>;
  /**
   * ページの表示を引く
   * @param pageNumber ページ番号（1 から）
   * @returns ページの表示。なければ undefined
   */
  readonly getPageView: (pageNumber: number) => RubyPageView | undefined;
}

/**
 * ページのルビを、画面の上の箱にする。
 * @param pageNumber ページ番号（1 から）
 * @param boxes ページに出しているルビ
 * @param viewport ページの今の表示の大きさと向き
 * @param origin 紙面（ルビの層を入れる要素）の左上の、画面の上の位置
 * @param origin.left 左の端
 * @param origin.top 上の端
 * @returns 画面の上に置いたルビ
 */
export function placeRubies(
  pageNumber: number,
  boxes: readonly RubyBox[],
  viewport: Pick<PageViewport, 'transform'>,
  origin: { readonly left: number; readonly top: number },
): PlacedRuby[] {
  const matrix = toMatrix(viewport.transform);
  return boxes.map((box) => {
    const rect = transformBox(matrix, box.area);
    return {
      pageNumber,
      box,
      rect: { ...rect, left: rect.left + origin.left, top: rect.top + origin.top },
    };
  });
}

/**
 * 点から箱までの距離。点が箱の中なら 0。
 * @param box 箱
 * @param point 点
 * @returns 距離（px）
 */
export function distanceToBox(box: Box, point: ScreenPoint): number {
  const dx = Math.max(box.left - point.x, 0, point.x - (box.left + box.width));
  const dy = Math.max(box.top - point.y, 0, point.y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

/**
 * 点にいちばん近いルビを選ぶ。箱が重なるとき（ルビが親字より長いときなど）は、箱の中心が近いほうを選ぶ。
 * @param rubies 画面の上に置いたルビ
 * @param point 点
 * @param search 探し方
 * @returns 選んだルビ。近くになければ undefined
 */
export function pickRuby(
  rubies: readonly PlacedRuby[],
  point: ScreenPoint,
  search: RubySearch,
): PlacedRuby | undefined {
  let best: { ruby: PlacedRuby; distance: number; center: number } | undefined;
  for (const ruby of rubies) {
    if (search.within !== undefined && !isOverlapping(ruby.rect, search.within)) continue;
    const distance = distanceToBox(ruby.rect, point);
    if (distance > search.maxDistance) continue;
    const center = Math.hypot(
      ruby.rect.left + ruby.rect.width / 2 - point.x,
      ruby.rect.top + ruby.rect.height / 2 - point.y,
    );
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && center < best.center)
    ) {
      best = { ruby, distance, center };
    }
  }
  return best?.ruby;
}

/**
 * 出しているページから、画面の上の点に近いルビを探す。
 * @param options ルビを探す部品の作り方
 * @param point 画面の上の点
 * @param search 探し方
 * @returns 見つけたルビ。なければ undefined
 */
export function findRuby(
  options: RubyFinderOptions,
  point: ScreenPoint,
  search: RubySearch,
): PlacedRuby | undefined {
  const rubies = options.pages.shownPages().flatMap((pageNumber) => {
    const view = options.getPageView(pageNumber);
    if (view === undefined) return [];
    // ルビの層は紙面の入れ物（.canvasWrapper）の左上を原点に置く
    const wrapper = view.div.querySelector('.canvasWrapper') ?? view.div;
    const origin = wrapper.getBoundingClientRect();
    return placeRubies(pageNumber, options.pages.rubiesOf(pageNumber), view.viewport, origin);
  });
  return pickRuby(rubies, point, search);
}

/**
 * 2つの箱が重なるか。
 * @param a 1つめの箱
 * @param b 2つめの箱
 * @returns 重なれば true
 */
function isOverlapping(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}
