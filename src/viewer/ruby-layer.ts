// ページにルビの層（DOM）を重ねる。
// 層は pdf.js の文字の層と同じく、回す前のページの大きさで作り、倍率（--total-scale-factor）と
// 回す向き（data-main-rotation）は pdf.js の CSS に任せる。だから拡大・縮小の途中でもルビが字に付いてくる。
// 層は紙面の入れ物（.canvasWrapper）の最後に置く。pdf.js は拡大のときこの入れ物を残すので、層も残る。
import type { PageViewport } from 'pdfjs-dist';
import { setLayerDimensions } from 'pdfjs-dist';

import type { RubyBox } from './ruby-layout';

/** ルビの層の class */
export const RUBY_LAYER_CLASS = 'ruby-layer';
/** ルビの下に帯を敷くときに、ルビの層を入れる要素に付ける class */
export const RUBY_BAND_CLASS = 'ruby-band';
/** 縦書きのルビの class */
const VERTICAL_CLASS = 'ruby-vertical';
/** 親字が明朝のルビの class（ルビも明朝にする） */
const SERIF_CLASS = 'ruby-serif';

/**
 * ページにルビの層を出す。前に出した層がまだページにあれば、それを使い、大きさと向きだけ合わせ直す。
 * @param pageDiv pdf.js のページの div
 * @param viewport ページの今の表示の大きさと向き
 * @param boxes 置くルビ
 * @param previous 前に出した層
 * @returns 出した層
 */
export function showRubyLayer(
  pageDiv: HTMLDivElement,
  viewport: PageViewport,
  boxes: readonly RubyBox[],
  previous: HTMLDivElement | undefined,
): HTMLDivElement {
  const wrapper = pageDiv.querySelector('.canvasWrapper') ?? pageDiv;
  let layer = previous;
  if (layer?.parentElement !== wrapper) {
    layer = document.createElement('div');
    layer.className = RUBY_LAYER_CLASS;
    // 画面の読み上げは本文（文字の層）だけにする
    layer.setAttribute('aria-hidden', 'true');
    layer.append(...boxes.map(toElement));
    wrapper.append(layer);
  }
  setLayerDimensions(layer, viewport);
  return layer;
}

/**
 * 1つのルビを要素にする。
 * @param box 置くルビ
 * @returns ルビの要素
 */
function toElement(box: RubyBox): HTMLSpanElement {
  const element = document.createElement('span');
  if (box.isVertical) element.classList.add(VERTICAL_CLASS);
  if (box.isSerif) element.classList.add(SERIF_CLASS);
  element.textContent = box.ruby;
  element.dataset.base = box.base;
  const { style } = element;
  style.left = scaled(box.left);
  style.top = scaled(box.top);
  style.width = scaled(box.width);
  style.height = scaled(box.height);
  style.fontSize = `calc(var(--ruby-size) * ${scaled(box.baseSize * box.shrink)})`;
  return element;
}

/**
 * PDF の単位の長さを、今の倍率をかけた CSS の長さにする。
 * @param length 長さ（PDF の単位）
 * @returns CSS の長さ
 */
function scaled(length: number): string {
  return `calc(var(--total-scale-factor) * ${length.toFixed(2)}px)`;
}
