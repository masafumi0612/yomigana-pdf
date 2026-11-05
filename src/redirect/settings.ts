import { browser } from 'wxt/browser';

import { AUTO_REDIRECT_STORAGE_KEY, isAutoRedirectOnByDefault } from '@/config';

/**
 * 「PDF を自動でリーダーで開く」の親スイッチの値を読む。
 *
 * @returns スイッチの値。まだ保存していない・真偽値でないときは既定（オフ）
 */
export async function getAutoRedirect(): Promise<boolean> {
  const stored = await browser.storage.sync.get(AUTO_REDIRECT_STORAGE_KEY);
  const value: unknown = stored[AUTO_REDIRECT_STORAGE_KEY];
  return typeof value === 'boolean' ? value : isAutoRedirectOnByDefault;
}

/**
 * 親スイッチの値を保存する。
 *
 * @param isEnabled - オンにするなら true
 */
export async function setAutoRedirect(isEnabled: boolean): Promise<void> {
  await browser.storage.sync.set({ [AUTO_REDIRECT_STORAGE_KEY]: isEnabled });
}
