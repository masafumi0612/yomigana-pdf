// 紙面を右クリック（またはメニューのキー・Shift+F10）したときのメニュー。
// ルビの上で開いたときだけ、頭にそのルビの見出しと「読みを直す…」を出す。上下の矢印・Home・End で項目を移る。
import { browser } from 'wxt/browser';

import type { PlacedRuby, ScreenPoint } from './ruby-hit';

/** メニューと画面の端の間の下限（px） */
const MENU_MARGIN_PX = 8;

/** 項目を移るキーと、移る先（今の位置と項目の数から出す） */
const MOVES: ReadonlyMap<string, (index: number, count: number) => number> = new Map([
  ['ArrowDown', (index: number, count: number) => (index + 1) % count],
  ['ArrowUp', (index: number, count: number) => (index - 1 + count) % count],
  ['Home', () => 0],
  ['End', (_index: number, count: number) => count - 1],
]);

/** 紙面のメニュー */
export interface PageMenu {
  /**
   * メニューを開き、最初の項目に移る。
   * @param point 開く位置（画面の上）
   * @param ruby 開いた所のルビ。ルビの上でなければ undefined
   */
  open(point: ScreenPoint, ruby: PlacedRuby | undefined): void;
  /** メニューを閉じる */
  close(): void;
}

/** 紙面のメニューの作り方 */
export interface PageMenuOptions {
  /** メニュー（role="menu"） */
  readonly menu: HTMLElement;
  /** ルビの見出しと「読みを直す…」のまとまり */
  readonly rubyGroup: HTMLElement;
  /** ルビの見出し */
  readonly rubyTitle: HTMLElement;
  /** 「読みを直す…」 */
  readonly fixItem: HTMLButtonElement;
  /**
   * 「読みを直す…」を選んだときに呼ぶ（メニューは閉じてから呼ぶ）
   * @param ruby メニューを開いた所のルビ
   */
  readonly onFix: (ruby: PlacedRuby) => void;
}

/**
 * 紙面のメニューを作る。
 * @param options 作り方
 * @returns 紙面のメニュー
 */
export function createPageMenu(options: PageMenuOptions): PageMenu {
  const { menu, rubyGroup, rubyTitle, fixItem } = options;
  let target: PlacedRuby | undefined;

  const items = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (item) => item.closest('[hidden]') === null,
    );

  const close = (): void => {
    menu.hidden = true;
    target = undefined;
  };

  menu.addEventListener('keydown', (event) => {
    const move = MOVES.get(event.key);
    if (move === undefined) return;
    event.preventDefault();
    const list = items();
    const index = list.findIndex((item) => item === document.activeElement);
    list[move(index, list.length)]?.focus();
  });
  fixItem.addEventListener('click', () => {
    const ruby = target;
    close();
    if (ruby !== undefined) options.onFix(ruby);
  });

  return {
    open(point, ruby) {
      target = ruby;
      rubyGroup.hidden = ruby === undefined;
      if (ruby !== undefined) {
        const title = browser.i18n.getMessage('viewer_menu_rubyTitle', [
          ruby.box.base,
          ruby.box.ruby,
        ]);
        rubyTitle.textContent = title;
        rubyGroup.setAttribute('aria-label', title);
      }
      menu.hidden = false;
      // 画面の右や下の端で開いても、はみ出さないようにする
      const left = Math.min(point.x, innerWidth - menu.offsetWidth - MENU_MARGIN_PX);
      const top = Math.min(point.y, innerHeight - menu.offsetHeight - MENU_MARGIN_PX);
      menu.style.left = `${String(Math.max(left, MENU_MARGIN_PX))}px`;
      menu.style.top = `${String(Math.max(top, MENU_MARGIN_PX))}px`;
      items()[0]?.focus();
    },
    close,
  };
}
