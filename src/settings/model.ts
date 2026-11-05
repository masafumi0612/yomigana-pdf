// 利用者が変えられる設定の形と既定。保存の処理（storage.ts）と画面の両方から使う
import type { Level } from '@/text/types';

/** ルビの字の大きさ（小・中・大） */
export type RubySize = 's' | 'm' | 'l';

/** ルビの色（黒・青・橙） */
export type RubyColor = 'ink' | 'blue' | 'orange';

/** ルビを付ける単位。いまは「まだ習っていない字」だけ */
export type RubyUnit = 'unlearned-char';

/** ルビの見た目 */
export interface RubyStyle {
  readonly size: RubySize;
  readonly color: RubyColor;
  /** ルビの下に帯を敷くなら true */
  readonly hasBand: boolean;
}

/** 利用者が変えられる設定。名前はそのまま `storage.sync` のキーになる */
export interface Settings {
  /** 「PDF を自動でリーダーで開く」の親スイッチ */
  readonly autoRedirect: boolean;
  /** この段階までに習う字にはルビを付けない */
  readonly level: Level;
  readonly rubyUnit: RubyUnit;
  readonly rubyStyle: RubyStyle;
}

/** 設定の名前（＝保存のキー） */
export type SettingKey = keyof Settings;

/** 設定のキーを並べたもの。利用者の辞書など、設定でないキーはここに入れない */
export const SETTING_KEYS: readonly SettingKey[] = [
  'autoRedirect',
  'level',
  'rubyUnit',
  'rubyStyle',
];

/**
 * 設定の既定。親スイッチは、許可を求める前に PDF を勝手に移さないようオフ。
 * 段階は、すべての漢字にルビを付ける `all`
 */
export const DEFAULT_SETTINGS: Settings = {
  autoRedirect: false,
  level: 'all',
  rubyUnit: 'unlearned-char',
  rubyStyle: { size: 'm', color: 'ink', hasBand: false },
};

/** ルビの字の大きさ（親字の大きさに対する割合） */
export const RUBY_SIZE_RATIOS: Readonly<Record<RubySize, number>> = {
  s: 0.42,
  m: 0.5,
  l: 0.6,
};

/** ルビの色（CSS の色）。どれも白い紙に対して 4.5:1 以上の差がある（テストで確かめる） */
export const RUBY_COLORS: Readonly<Record<RubyColor, string>> = {
  ink: '#000000',
  blue: '#1d4ed8',
  orange: '#c2410c',
};
