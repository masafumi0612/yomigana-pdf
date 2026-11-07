// 設定の画面を開くときに、どの場所を画面の上に出すかを伝える。
// 開く側（リーダー）が storage.session に印を残し、設定の画面が読んで消す。
// 設定の画面がもう開いているときは、Chrome がそのタブに移るだけなので、印が変わったのを見張って動かす
import { browser } from 'wxt/browser';

/** 画面の上に出す場所の印のキー */
const JUMP_KEY = 'optionsJumpTo';

/** 設定の画面で、上に出せる場所 */
export type JumpTarget = 'amount';

/**
 * 保存してある値が、上に出せる場所かを調べる。
 * @param value storage.session の値
 * @returns 上に出せる場所なら true
 */
export function isJumpTarget(value: unknown): value is JumpTarget {
  return value === 'amount';
}

/**
 * 次に開く（または移る）設定の画面で、上に出す場所を残す。
 * @param target 上に出す場所
 */
export async function requestJump(target: JumpTarget): Promise<void> {
  await browser.storage.session.set({ [JUMP_KEY]: target });
}

/**
 * 残してある場所を読み、消す。続けて開いたときに、同じ場所へまた動かないようにする。
 * @returns 上に出す場所。残っていなければ undefined
 */
export async function takeJump(): Promise<JumpTarget | undefined> {
  const stored = await browser.storage.session.get(JUMP_KEY);
  const value: unknown = stored[JUMP_KEY];
  if (!isJumpTarget(value)) {
    return undefined;
  }
  await browser.storage.session.remove(JUMP_KEY);
  return value;
}

/**
 * 上に出す場所が新しく残されたら知らせる。
 * @param onRequest 残されたときに呼ぶ
 * @returns 見張りをやめる関数
 */
export function watchJump(onRequest: () => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>): void => {
    if (isJumpTarget(changes[JUMP_KEY]?.newValue)) {
      onRequest();
    }
  };
  browser.storage.session.onChanged.addListener(listener);
  return () => {
    browser.storage.session.onChanged.removeListener(listener);
  };
}
