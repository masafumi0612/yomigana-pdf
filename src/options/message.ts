// 設定の画面の文言を public/_locales から引く
import { browser } from 'wxt/browser';

/** 文言のキー */
export type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/**
 * 文言を引く。
 * @param name 文言のキー
 * @param substitution 文言の中の `$1` に入れる文字
 * @returns 文言
 */
export function message(name: MessageName, substitution?: string): string {
  return browser.i18n.getMessage(name, substitution);
}
