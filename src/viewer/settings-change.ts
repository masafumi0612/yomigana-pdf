// 設定が変わったときに、ルビの層の何をやり直すかを決める。画面は触らない
import type { Settings } from '@/settings/model';

/** 設定が変わったときにやり直すこと。色と帯は CSS 変数と class だけで変わるので、ここには入れない */
export interface SettingsChange {
  /** 段階が変わったなら true。読みを問い合わせ直す */
  readonly isLevelChanged: boolean;
  /** ルビの大きさが変わったなら true。行間がせまいときの縮め方も変わるので、置き直す */
  readonly isSizeChanged: boolean;
}

/**
 * 前の設定と今の設定を比べ、ルビの層でやり直すことを決める。
 * @param before 前の設定
 * @param after 今の設定
 * @returns やり直すこと
 */
export function settingsChange(before: Settings, after: Settings): SettingsChange {
  return {
    isLevelChanged: before.level !== after.level,
    isSizeChanged: before.rubyStyle.size !== after.rubyStyle.size,
  };
}

/**
 * ページを、今のページに近い順に並べる。近さが同じなら、番号の小さいページを先にする。
 * @param pages ページ番号
 * @param current 今のページ番号
 * @returns 並べたページ番号
 */
export function nearestFirst(pages: readonly number[], current: number): number[] {
  return pages.toSorted((p, q) => Math.abs(p - current) - Math.abs(q - current) || p - q);
}
