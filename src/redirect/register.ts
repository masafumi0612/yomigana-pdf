import type { Browser } from 'wxt/browser';

import { buildRedirectRules } from '@/redirect/rules';

/** ルールの登録に使う、DNR の動的ルールの出し入れ */
export interface DynamicRuleStore {
  /** 登録済みのルールを返す */
  getRules(): Promise<Browser.declarativeNetRequest.Rule[]>;
  /** 指定のルールを消し、新しいルールを足す */
  updateRules(
    removeRuleIds: number[],
    addRules: Browser.declarativeNetRequest.Rule[],
  ): Promise<void>;
}

/** ルールを登録すべきかを決める材料 */
export interface RedirectState {
  /** 親スイッチがオンか */
  isEnabled: boolean;
  /** すべてのサイトを読む権限が許可されているか */
  hasHostAccess: boolean;
}

/**
 * ルールを登録すべきかを返す。親スイッチがオンで、サイトを読む権限が許可されているときだけ登録する。
 *
 * @param state - スイッチと権限の状態
 * @returns 登録するなら true
 */
export function shouldRegisterRules(state: RedirectState): boolean {
  return state.isEnabled && state.hasHostAccess;
}

/**
 * 登録済みのルールを、今の状態に合わせる。同じ内容なら何もしない。
 *
 * @param store - 動的ルールの出し入れ
 * @param viewerUrl - リーダーの URL
 * @param state - スイッチと権限の状態
 * @returns ルールを入れ替えたら true
 */
export async function syncRedirectRules(
  store: DynamicRuleStore,
  viewerUrl: string,
  state: RedirectState,
): Promise<boolean> {
  const desired = shouldRegisterRules(state) ? buildRedirectRules(viewerUrl) : [];
  const current = await store.getRules();
  if (JSON.stringify(current) === JSON.stringify(desired)) {
    return false;
  }
  await store.updateRules(
    current.map((rule) => rule.id),
    desired,
  );
  return true;
}
