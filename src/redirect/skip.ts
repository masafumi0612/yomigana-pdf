import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';

/** 正規表現で URL を指すときの長さの上限。DNR の正規表現は大きさに上限があるので、超えたらタブだけで指す */
const MAX_REGEX_URL_LENGTH = 500;

/**
 * 正規表現の特別な字を、そのままの字として扱えるようにする。
 *
 * @param text - 元の文
 * @returns 符号化した文
 */
function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, (char) => `\\${char}`);
}

/**
 * このタブで、この URL だけ（長すぎる URL はこのタブのページ全体）をリーダーに移さない（Chrome の標準の表示で開く）セッションルールを作る。
 * ルールの id はタブの番号と同じにして、同じタブでは1件だけ持つ。ブラウザを閉じると消える。
 *
 * @param tabId - 標準の表示で開くタブ
 * @param url - 開く PDF の URL
 * @returns セッションルール
 */
export function buildSkipRule(tabId: number, url: string): Browser.declarativeNetRequest.Rule {
  return {
    id: tabId,
    // 移すルールの優先度（5 件）より高くする
    priority: 100,
    condition: {
      tabIds: [tabId],
      ...(url.length <= MAX_REGEX_URL_LENGTH && { regexFilter: `^${escapeRegex(url)}$` }),
      resourceTypes: ['main_frame'],
    },
    action: { type: 'allow' },
  };
}

/**
 * リーダーのタブで、これから開く PDF の URL をリーダーに戻されないようにする。
 *
 * @param url - Chrome の標準の表示で開く PDF の URL
 */
export async function allowNativeView(url: string): Promise<void> {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id === undefined) {
    return;
  }
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tab.id],
    addRules: [buildSkipRule(tab.id, url)],
  });
}

/**
 * タブを閉じたときに、そのタブのセッションルールを消す。
 *
 * @param tabId - 閉じたタブ
 */
export async function clearSkipRule(tabId: number): Promise<void> {
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
}
