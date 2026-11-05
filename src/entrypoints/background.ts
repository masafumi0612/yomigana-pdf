import { browser } from 'wxt/browser';

import { AUTO_REDIRECT_STORAGE_KEY } from '@/config';
import { createLogger } from '@/log';
import { type DynamicRuleStore, syncRedirectRules } from '@/redirect/register';
import { getAutoRedirect } from '@/redirect/settings';
import { clearSkipRule } from '@/redirect/skip';

/** すべてのサイトを読む権限。後から利用者に許可してもらう */
const ALL_URLS = { origins: ['<all_urls>'] };

const log = createLogger('background');

const dynamicRules: DynamicRuleStore = {
  getRules: () => browser.declarativeNetRequest.getDynamicRules(),
  updateRules: (removeRuleIds, addRules) =>
    browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }),
};

/** 続けて来た変更で、ルールの入れ替えが重ならないよう、順に動かすための鎖 */
let syncQueue: Promise<unknown> = Promise.resolve();

/** 親スイッチと権限を読み直して、ルールを今の状態に合わせる */
function syncRules(): void {
  syncQueue = syncQueue
    .then(async () => {
      const [isEnabled, hasHostAccess] = await Promise.all([
        getAutoRedirect(),
        browser.permissions.contains(ALL_URLS),
      ]);
      await syncRedirectRules(dynamicRules, browser.runtime.getURL('/viewer.html'), {
        isEnabled,
        hasHostAccess,
      });
    })
    .catch((error: unknown) => {
      log.error('PDF を移すルールの登録に失敗しました', error);
    });
}

export default defineBackground(() => {
  // 起動のたびに合わせ直す（拡張の更新でルールが変わったときも、ここで入れ替わる）
  syncRules();
  browser.permissions.onAdded.addListener(syncRules);
  browser.permissions.onRemoved.addListener(syncRules);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && AUTO_REDIRECT_STORAGE_KEY in changes) {
      syncRules();
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    clearSkipRule(tabId).catch((error: unknown) => {
      log.error('標準の表示のルールを消すのに失敗しました', error);
    });
  });
});
