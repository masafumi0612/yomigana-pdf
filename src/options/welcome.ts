// 初めて入れた直後に設定の画面で出す案内の状態を、storage.local に残す。
// パソコンごとに入れるものなので、同期（storage.sync）はしない
import { browser } from 'wxt/browser';

/**
 * 入れた直後の案内を閉じたか。初めて入れたときに false を書き、閉じたら true にする。
 * 値がないのは、案内を足す前の版から更新したときなので、案内は出さない
 */
const WELCOME_DISMISSED_KEY = 'welcomeDismissed';

/**
 * 保存してある値から、入れた直後の案内を出すかを決める。
 * @param stored storage.local の「入れた直後の案内を閉じたか」の値
 * @returns 初めて入れたあと、まだ閉じていないなら true
 */
export function isWelcomeShown(stored: unknown): boolean {
  return stored === false;
}

/**
 * 初めて入れたことを残す。拡張を入れたときに background から呼ぶ。
 */
export async function startWelcome(): Promise<void> {
  await browser.storage.local.set({ [WELCOME_DISMISSED_KEY]: false });
}

/**
 * 入れた直後の案内を出すかを読む。
 * @returns 出すなら true
 */
export async function getWelcomeShown(): Promise<boolean> {
  const stored = await browser.storage.local.get(WELCOME_DISMISSED_KEY);
  return isWelcomeShown(stored[WELCOME_DISMISSED_KEY]);
}

/**
 * 入れた直後の案内を閉じたことを残す。次に設定の画面を開いても出さない。
 */
export async function dismissWelcome(): Promise<void> {
  await browser.storage.local.set({ [WELCOME_DISMISSED_KEY]: true });
}
