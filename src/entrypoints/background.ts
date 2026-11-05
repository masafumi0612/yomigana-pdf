import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { startWelcome } from '@/options/welcome';
import { type DynamicRuleStore, syncRedirectRules } from '@/redirect/register';
import { clearSkipRule } from '@/redirect/skip';
import type { SettingKey } from '@/settings/model';
import { getSettings } from '@/settings/storage';

/** すべてのサイトを読む権限。後から利用者に許可してもらう */
const ALL_URLS = { origins: ['<all_urls>'] };

/** 親スイッチの設定のキー。ほかの設定が変わっても、ルールは合わせ直さない */
const AUTO_REDIRECT_KEY: SettingKey = 'autoRedirect';

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
      const [settings, hasHostAccess] = await Promise.all([
        getSettings(),
        browser.permissions.contains(ALL_URLS),
      ]);
      await syncRedirectRules(dynamicRules, browser.runtime.getURL('/viewer.html'), {
        isEnabled: settings.autoRedirect,
        hasHostAccess,
      });
    })
    .catch((error: unknown) => {
      log.error('PDF を移すルールの登録に失敗しました', error);
    });
}

/** 設定の画面をタブで開く */
function openOptions(): void {
  browser.runtime.openOptionsPage().catch((error: unknown) => {
    log.error('設定の画面を開くのに失敗しました', error);
  });
}

export default defineBackground(() => {
  // 拡張のアイコンを押したら、小さな枠ではなく設定の画面を開く
  browser.action.onClicked.addListener(openOptions);
  // 初めて入れたときだけ開く。更新のたびには開かない。
  // 開いた画面が入れた直後の案内を出せるよう、先に印を残す（残せなくても画面は開く）
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      startWelcome().then(openOptions, (error: unknown) => {
        log.error('入れた直後の案内の印を残すのに失敗しました', error);
        openOptions();
      });
    }
  });
  // 起動のたびに合わせ直す（拡張の更新でルールが変わったときも、ここで入れ替わる）
  syncRules();
  browser.permissions.onAdded.addListener(syncRules);
  browser.permissions.onRemoved.addListener(syncRules);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && AUTO_REDIRECT_KEY in changes) {
      syncRules();
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    clearSkipRule(tabId).catch((error: unknown) => {
      log.error('標準の表示のルールを消すのに失敗しました', error);
    });
  });
});
