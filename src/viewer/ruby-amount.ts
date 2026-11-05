// リーダーのバーの、今のルビの量を出すボタンの文字
import { levelAmountText, type MessageLookup } from '@/settings/level-text';
import type { Level } from '@/text/types';

/** バーのボタンの文字と、読み上げ用の名前 */
export interface RubyAmountLabel {
  /** 見えている文字（例：ルビ：3年までの漢字には付けない） */
  readonly text: string;
  /** 読み上げ用の名前。見えている文字に、押すと設定の画面が開くことを足す */
  readonly name: string;
}

/**
 * バーのボタンに出す、今のルビの量を作る。
 * @param level 段階
 * @param message 文言を引く関数
 * @returns ボタンの文字と名前
 */
export function rubyAmountLabel(level: Level, message: MessageLookup): RubyAmountLabel {
  const text = message('viewer_bar_rubyAmount', levelAmountText(level, message));
  return { text, name: message('viewer_bar_rubyAmountName', text) };
}
