// 特別な場面（文字が取れない PDF・ルビを付けられなかったページ）の判定。画面は触らない

/**
 * 文字が画像になっていて、ルビを付けられない PDF かを調べる。
 * 白紙のページだけで決めないよう、文のあるページが1つでもあれば false にする。
 * @param hasTextByPage 描いたページごとの、文があるか（ページ番号は 1 から）
 * @returns 描いたページが1つ以上あり、どれにも文がなければ true
 */
export function isImageOnlyDocument(hasTextByPage: ReadonlyMap<number, boolean>): boolean {
  return hasTextByPage.size > 0 && ![...hasTextByPage.values()].some(Boolean);
}

/**
 * 読みを出せなかったページの記録。出せなかったページを覚え、問い合わせ直すときに引く。
 */
export interface FailedPages<View> {
  /**
   * 読みを出せなかったことを覚える。
   * @param pageNumber ページ番号
   * @param view ページの表示
   */
  add(pageNumber: number, view: View): void;
  /**
   * 読みを出せたことを覚える（出せなかった記録を消す）。
   * @param pageNumber ページ番号
   */
  remove(pageNumber: number): void;
  /** 全部消す */
  clear(): void;
  /** 出せなかったページの数 */
  readonly size: number;
  /**
   * 出せなかったページを挙げる。
   * @returns ページ番号と表示の組（ページ番号の順）
   */
  list(): readonly (readonly [number, View])[];
}

/**
 * 読みを出せなかったページの記録を作る。
 * @returns 記録
 */
export function createFailedPages<View>(): FailedPages<View> {
  const pages = new Map<number, View>();
  return {
    add: (pageNumber, view) => {
      pages.set(pageNumber, view);
    },
    remove: (pageNumber) => {
      pages.delete(pageNumber);
    },
    clear: () => {
      pages.clear();
    },
    get size() {
      return pages.size;
    },
    list: () => [...pages].sort(([a], [b]) => a - b),
  };
}
