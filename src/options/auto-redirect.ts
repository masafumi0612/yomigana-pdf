// 「PDF を開いたら、自動でルビを付ける」のスイッチの見せ方

/** すべてのサイトを読む権限。スイッチをオンにするときに求める */
export const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * スイッチをオンに見せるかを決める。保存した値がオンでも、Chrome の設定で権限を外されていれば
 * PDF は移らないので、オフに見せる。
 * @param isEnabled 保存してあるスイッチの値
 * @param hasHostAccess すべてのサイトを読む権限があるなら true
 * @returns オンに見せるなら true
 */
export function isAutoRedirectShownOn(isEnabled: boolean, hasHostAccess: boolean): boolean {
  return isEnabled && hasHostAccess;
}
