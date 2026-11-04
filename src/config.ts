// 拡張全体で使う既定の値
import type { Level } from '@/text/types';

/** 段階の既定（設定画面ができるまで、読みの問い合わせはこの段階を使う）。すべての漢字にルビを付ける */
export const DEFAULT_LEVEL: Level = 'all';

/** 拡張の中で、kuromoji の辞書（gzip）を置くフォルダ。ビルドで @patdx/kuromoji から写す */
export const DICTIONARY_DIR = 'dict';

/** ルビの字の大きさの既定（親字の大きさに対する割合）。設定画面ができるまで、この値を使う */
export const RUBY_SIZE_RATIO = 0.5;

/** ルビの色の既定（CSS の色）。設定画面ができるまで、この値を使う */
export const RUBY_COLOR = '#000000';
