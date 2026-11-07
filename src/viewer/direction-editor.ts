// 文字の向きを直すモードの紙面の部分。かたまりごとに枠を重ね、選んだかたまりにだけ［縦書き｜横書き］の切り替えを出す。
// 切り替えを1つだけにするのは、縦書きの列が詰まった紙面で、隣のかたまりの切り替えと重ならないようにするため。
// ルビの層とは別の層（ページの div の直下）に置く。回した紙面でも切り替えの字が横に倒れないよう、
// 層そのものは回さず、かたまりの箱を今の向きの紙面の位置に置き直す。切り替えは枠の角の外側に置き、本文を隠さない。
import { setLayerDimensions } from 'pdfjs-dist';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { isDirectionUncertain } from '@/pdf/direction';
import type { Direction, TextBlock } from '@/pdf/types';

import type { PageLayouts } from './page-layout';
import type { RubyPages, RubyPageView } from './ruby-pages';
import { toMatrix, transformBox } from './transform';

/** 向きを直す層の class */
export const DIRECTION_LAYER_CLASS = 'direction-layer';
/** かたまりの枠の class */
const BLOCK_CLASS = 'direction-block';
/** 向きの切り替えの class */
const TOGGLE_CLASS = 'direction-toggle';
/** 切り替えを枠の上に置くには足りない、枠の上の余白（画面の px）。これより上に詰まるときは枠の下に置く */
const TOGGLE_ROOM_PX = 36;
/** 切り替えの向きの並び */
const DIRECTIONS: readonly Direction[] = ['vertical', 'horizontal'];

const log = createLogger('direction-editor');

/** 向きを直すモードの紙面の部分 */
export interface DirectionEditor {
  /** モードに入る。出しているページに枠を重ね、最初のかたまりを選んでそこに移る */
  enter(): void;
  /** モードを終える。重ねたものをすべて外し、選んだかたまりも忘れる */
  exit(): void;
  /**
   * ページを出し直したときに呼ぶ。モードの間だけ、そのページの枠と切り替えを作り直す。
   * @param pageNumber ページ番号（1 から）
   */
  refreshPage(pageNumber: number): void;
}

/** 向きを直す部品の作り方 */
export interface DirectionEditorOptions {
  /** ルビの置き場所を出す部品（かたまりを引く） */
  readonly layouts: Pick<PageLayouts, 'blocksOf'>;
  /** ルビの層の部品（層を出しているページを引き、向きを決め直す） */
  readonly pages: Pick<RubyPages, 'shownPages' | 'setBlockDirection'>;
  /**
   * ページの表示を引く
   * @param pageNumber ページ番号（1 から）
   * @returns ページの表示。なければ undefined
   */
  readonly getPageView: (pageNumber: number) => RubyPageView | undefined;
}

/** 選んだかたまり */
interface Selection {
  readonly pageNumber: number;
  readonly index: number;
}

/**
 * 切り替えが紙面の左右からはみ出さないよう、横にずらして収める。
 * 枠が紙面の右の端に近いと、枠の左に合わせた切り替えが右に切れるため。
 * 見えているときの大きさで測るので、出したあとに呼ぶ。
 * @param toggle 切り替え
 */
function keepInPage(toggle: HTMLElement): void {
  const page = toggle.closest<HTMLElement>('.page');
  if (page === null || toggle.hidden) return;
  toggle.style.translate = '';
  const paper = page.getBoundingClientRect();
  const box = toggle.getBoundingClientRect();
  // 右に切れるぶんを左に戻し、それで左に切れるなら、左の端に合わせる（左を優先する）
  const shift = Math.max(Math.min(0, paper.right - box.right), paper.left - box.left);
  if (shift !== 0) toggle.style.translate = `${shift.toFixed(2)}px`;
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
 * 倍率 1 のときの CSS の長さを、今の倍率をかけた CSS の長さにする。
 * @param length 長さ（倍率 1 のときの px）
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
  let selected: Selection | undefined;

  const layerOf = (view: RubyPageView): Element | null =>
    view.div.querySelector(`:scope > .${DIRECTION_LAYER_CLASS}`);

  const isSelected = (pageNumber: number, index: number): boolean =>
    selected?.pageNumber === pageNumber && selected.index === index;

  // 選んだかたまりの切り替えだけを出す。ほかの切り替えは隠し、Tab でも移らないようにする
  const showSelection = (): void => {
    for (const frame of document.querySelectorAll<HTMLElement>(`.${BLOCK_CLASS}`)) {
      const isOn = isSelected(Number(frame.dataset.page), Number(frame.dataset.index));
      frame.dataset.selected = String(isOn);
      const toggle = frame.querySelector<HTMLElement>(`.${TOGGLE_CLASS}`);
      if (toggle === null) continue;
      toggle.hidden = !isOn;
      keepInPage(toggle);
    }
  };

  const select = (next: Selection | undefined): void => {
    if (next?.pageNumber === selected?.pageNumber && next?.index === selected?.index) return;
    selected = next;
    showSelection();
  };

  // 紙面のかたまりの外を押したら、選ぶのをやめる（バーなど紙面の外を押したときは、選んだままにする）
  const handlePointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest(`.${BLOCK_CLASS}`) === null &&
      event.target.closest('.page') !== null
    ) {
      select(undefined);
    }
  };

  const choose = (pageNumber: number, index: number, direction: Direction): void => {
    options.pages.setBlockDirection(pageNumber, index, direction).catch((error: unknown) => {
      log.error('かたまりの向きを決め直す途中で予想外の失敗がありました', error);
    });
  };

  const toggleOf = (pageNumber: number, index: number, block: TextBlock): HTMLButtonElement => {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = TOGGLE_CLASS;
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
    const { viewport } = view;
    // 今の向きと倍率の紙面の上の箱。倍率で割って、倍率 1 のときの長さにしておく
    const box = transformBox(toMatrix(viewport.transform), block.rect);
    const frame = document.createElement('div');
    frame.className = BLOCK_CLASS;
    frame.dataset.page = String(pageNumber);
    frame.dataset.index = String(index);
    frame.dataset.uncertain = String(isDirectionUncertain(block));
    // Tab で移れるようにし、移ったらそのかたまりを選ぶ
    frame.tabIndex = 0;
    frame.setAttribute('role', 'group');
    const unsure = isDirectionUncertain(block)
      ? browser.i18n.getMessage('viewer_direction_uncertain')
      : '';
    frame.setAttribute(
      'aria-label',
      browser.i18n.getMessage('viewer_direction_block', nameOf(block.direction)) + unsure,
    );
    const { style } = frame;
    style.left = scaled(box.left / viewport.scale);
    style.top = scaled(box.top / viewport.scale);
    style.width = scaled(box.width / viewport.scale);
    style.height = scaled(box.height / viewport.scale);
    const toggle = toggleOf(pageNumber, index, block);
    // 紙面の上の端に詰まる枠は、切り替えを枠の下に置く
    toggle.dataset.place = box.top < TOGGLE_ROOM_PX ? 'below' : 'above';
    toggle.hidden = !isSelected(pageNumber, index);
    frame.dataset.selected = String(!toggle.hidden);
    frame.append(toggle);
    frame.addEventListener('focusin', () => {
      select({ pageNumber, index });
    });
    return frame;
  };

  const build = (pageNumber: number): void => {
    const view = options.getPageView(pageNumber);
    if (view === undefined) return;
    const old = layerOf(view);
    // 作り直す前に、移っていた枠か切り替えを覚えておき、作り直したあとも同じところに留める
    const focused =
      old?.contains(document.activeElement) === true && document.activeElement instanceof Element
        ? document.activeElement
        : undefined;
    const focusedIndex = focused?.closest<HTMLElement>(`.${BLOCK_CLASS}`)?.dataset.index;
    const isToggleFocused = focused?.classList.contains(TOGGLE_CLASS) === true;
    old?.remove();
    const blocks = options.layouts.blocksOf(pageNumber);
    if (blocks.length === 0) return;
    const layer = document.createElement('div');
    layer.className = DIRECTION_LAYER_CLASS;
    layer.append(...blocks.map((block, index) => frameOf(view, pageNumber, index, block)));
    view.div.append(layer);
    // 層は回さず、回したあとの紙面の大きさにだけ合わせる
    setLayerDimensions(layer, view.viewport, true, false);
    // 層が紙面に入って大きさが決まってから、選んだかたまりの切り替えを収める
    for (const toggle of layer.querySelectorAll<HTMLElement>(`.${TOGGLE_CLASS}`)) {
      keepInPage(toggle);
    }
    if (focusedIndex !== undefined) {
      const frame = layer.querySelector<HTMLElement>(`[data-index="${focusedIndex}"]`);
      const target = isToggleFocused
        ? frame?.querySelector<HTMLElement>(`.${TOGGLE_CLASS}`)
        : frame;
      target?.focus();
    }
  };

  return {
    enter() {
      isActive = true;
      document.addEventListener('pointerdown', handlePointerDown);
      for (const pageNumber of options.pages.shownPages()) build(pageNumber);
      document.querySelector<HTMLElement>(`.${DIRECTION_LAYER_CLASS} .${BLOCK_CLASS}`)?.focus();
    },
    exit() {
      isActive = false;
      selected = undefined;
      document.removeEventListener('pointerdown', handlePointerDown);
      for (const layer of document.querySelectorAll(`.${DIRECTION_LAYER_CLASS}`)) layer.remove();
    },
    refreshPage(pageNumber) {
      if (isActive) build(pageNumber);
    },
  };
}
