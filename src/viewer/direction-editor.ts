// 文字の向きを直すモードの紙面の部分。かたまりごとに枠と［縦書き｜横書き］の切り替えを重ねる。
// ルビの層とは別の層（ページの div の直下）に置く。切り替えは枠の角の外側に置き、本文を隠さない。
import { setLayerDimensions } from 'pdfjs-dist';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { isDirectionUncertain } from '@/pdf/direction';
import type { Direction, TextBlock } from '@/pdf/types';

import type { RubyPages, RubyPageView } from './ruby-pages';

/** 向きを直す層の class */
export const DIRECTION_LAYER_CLASS = 'direction-layer';
/** 切り替えを枠の上に置くには足りない、枠の上の余白（画面の px）。これより上に詰まるときは枠の下に置く */
const TOGGLE_ROOM_PX = 36;
/** 切り替えの向きの並び */
const DIRECTIONS: readonly Direction[] = ['vertical', 'horizontal'];

const log = createLogger('direction-editor');

/** 向きを直すモードの紙面の部分 */
export interface DirectionEditor {
  /** モードに入る。出しているページに枠と切り替えを重ね、最初の切り替えに移る */
  enter(): void;
  /** モードを終える。重ねたものをすべて外す */
  exit(): void;
  /**
   * ページを出し直したときに呼ぶ。モードの間だけ、そのページの枠と切り替えを作り直す。
   * @param pageNumber ページ番号（1 から）
   */
  refreshPage(pageNumber: number): void;
}

/** 向きを直す部品の作り方 */
export interface DirectionEditorOptions {
  /** ルビの層の部品（かたまりを引き、向きを決め直す） */
  readonly pages: Pick<RubyPages, 'blocksOf' | 'shownPages' | 'setBlockDirection'>;
  /**
   * ページの表示を引く
   * @param pageNumber ページ番号（1 から）
   * @returns ページの表示。なければ undefined
   */
  readonly getPageView: (pageNumber: number) => RubyPageView | undefined;
}

/**
 * 向きの名前（文言）を引く。
 * @param direction 向き
 * @returns 縦書き・横書き
 */
function nameOf(direction: Direction): string {
  return browser.i18n.getMessage(
    direction === 'vertical' ? 'viewer_direction_vertical' : 'viewer_direction_horizontal',
  );
}

/**
 * PDF の単位の長さを、今の倍率をかけた CSS の長さにする。
 * @param length 長さ（PDF の単位）
 * @returns CSS の長さ
 */
function scaled(length: number): string {
  return `calc(var(--total-scale-factor) * ${length.toFixed(2)}px)`;
}

/**
 * ルビ付きの向きの名前の要素を作る。
 * @param direction 向き
 * @param current 今の向きか
 * @returns 切り替えの半分
 */
function optionOf(direction: Direction, current: Direction): HTMLSpanElement {
  const option = document.createElement('span');
  option.className = 'direction-option';
  option.dataset.direction = direction;
  option.dataset.current = String(direction === current);
  const reading = browser.i18n.getMessage(
    direction === 'vertical'
      ? 'viewer_direction_verticalReading'
      : 'viewer_direction_horizontalReading',
  );
  const ruby = document.createElement('ruby');
  ruby.append(
    nameOf(direction),
    Object.assign(document.createElement('rt'), { textContent: reading }),
  );
  option.append(ruby);
  return option;
}

/**
 * 向きを直す部品を作る。
 * @param options 作り方
 * @returns 向きを直す部品
 */
export function createDirectionEditor(options: DirectionEditorOptions): DirectionEditor {
  let isActive = false;

  const layerOf = (view: RubyPageView): Element | null =>
    view.div.querySelector(`:scope > .${DIRECTION_LAYER_CLASS}`);

  const choose = (pageNumber: number, index: number, direction: Direction): void => {
    options.pages.setBlockDirection(pageNumber, index, direction).catch((error: unknown) => {
      log.error('かたまりの向きを決め直す途中で予想外の失敗がありました', error);
    });
  };

  const toggleOf = (pageNumber: number, index: number, block: TextBlock): HTMLButtonElement => {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'direction-toggle';
    toggle.dataset.index = String(index);
    const next = block.direction === 'vertical' ? 'horizontal' : 'vertical';
    const label = browser.i18n.getMessage('viewer_direction_toggle', [
      nameOf(block.direction),
      nameOf(next),
    ]);
    const unsure = isDirectionUncertain(block)
      ? browser.i18n.getMessage('viewer_direction_uncertain')
      : '';
    toggle.setAttribute('aria-label', label + unsure);
    toggle.append(...DIRECTIONS.map((direction) => optionOf(direction, block.direction)));
    toggle.addEventListener('click', (event) => {
      // 半分を押したらその向きに、キーボードで押したら（半分の外が対象なら）もう一方の向きにする
      const half =
        event.target instanceof Element
          ? (event.target.closest<HTMLElement>('[data-direction]') ?? undefined)
          : undefined;
      const picked = DIRECTIONS.find((direction) => direction === half?.dataset.direction) ?? next;
      if (picked !== block.direction) choose(pageNumber, index, picked);
    });
    return toggle;
  };

  const frameOf = (
    view: RubyPageView,
    pageNumber: number,
    index: number,
    block: TextBlock,
  ): HTMLDivElement => {
    const [x1 = 0, , , y2 = 0] = view.viewport.viewBox;
    const frame = document.createElement('div');
    frame.className = 'direction-block';
    frame.dataset.uncertain = String(isDirectionUncertain(block));
    const { style } = frame;
    style.left = scaled(block.rect.x1 - x1);
    style.top = scaled(y2 - block.rect.y2);
    style.width = scaled(block.rect.x2 - block.rect.x1);
    style.height = scaled(block.rect.y2 - block.rect.y1);
    const toggle = toggleOf(pageNumber, index, block);
    // 紙面の上の端に詰まる枠は、切り替えを枠の下に置く
    const top = (y2 - block.rect.y2) * view.viewport.scale;
    toggle.dataset.place = top < TOGGLE_ROOM_PX ? 'below' : 'above';
    frame.append(toggle);
    return frame;
  };

  const build = (pageNumber: number): void => {
    const view = options.getPageView(pageNumber);
    if (view === undefined) return;
    const old = layerOf(view);
    const focusedIndex =
      old?.contains(document.activeElement) === true &&
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.index
        : undefined;
    old?.remove();
    const blocks = options.pages.blocksOf(pageNumber);
    if (blocks.length === 0) return;
    const layer = document.createElement('div');
    layer.className = DIRECTION_LAYER_CLASS;
    layer.append(...blocks.map((block, index) => frameOf(view, pageNumber, index, block)));
    view.div.append(layer);
    setLayerDimensions(layer, view.viewport);
    if (focusedIndex !== undefined) {
      layer.querySelector<HTMLElement>(`[data-index="${focusedIndex}"]`)?.focus();
    }
  };

  return {
    enter() {
      isActive = true;
      for (const pageNumber of options.pages.shownPages()) build(pageNumber);
      document.querySelector<HTMLElement>(`.${DIRECTION_LAYER_CLASS} .direction-toggle`)?.focus();
    },
    exit() {
      isActive = false;
      for (const layer of document.querySelectorAll(`.${DIRECTION_LAYER_CLASS}`)) layer.remove();
    },
    refreshPage(pageNumber) {
      if (isActive) build(pageNumber);
    },
  };
}
