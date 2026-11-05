// リーダーで、保存してある直した読みを読み、変わったら知らせる
import { createLogger } from '@/log';
import { withTimeout } from '@/messaging/timeout';
import { toUserDictionary } from '@/settings/dictionary-entry';
import { getUserDictionary, watchUserDictionary } from '@/settings/user-dictionary';
import type { UserDictionary } from '@/text/types';

/** 始めに直した読みを読むのを待つ時間の上限（ミリ秒）。過ぎたら直した読みなしで始める */
const DICTIONARY_TIMEOUT_MS = 1000;

/** 直した読みを渡すもの */
export interface UserDictionaryFeed {
  /**
   * 今の直した読みを読む。
   * @returns 直した読み。読めないとき・時間がかかるときは空（throw しない）
   */
  load(): Promise<UserDictionary>;
  /**
   * 直した読みが変わるのを見張る。
   * @param callback 変わったあとの直した読みを受け取る
   * @returns 見張るのをやめる関数
   */
  watch(callback: (dictionary: UserDictionary) => void): () => void;
}

const log = createLogger('ruby-layer');

/** 保存してある直した読みを渡すもの */
export const storedUserDictionary: UserDictionaryFeed = {
  /**
   * 保存してある直した読みを読む。
   * @returns 直した読み。読めないとき・時間がかかるときは空
   */
  async load() {
    try {
      const result = await withTimeout(getUserDictionary(), DICTIONARY_TIMEOUT_MS);
      if (result.ok) {
        return toUserDictionary(result.value.entries);
      }
      log.warn('直した読みを読むのに時間がかかったので、直した読みなしで始めます');
    } catch (error) {
      log.error('直した読みを読めなかったので、直した読みなしで始めます', error);
    }
    return new Map();
  },
  /**
   * 保存してある直した読みが変わるのを見張る。
   * @param callback 変わったあとの直した読みを受け取る
   * @returns 見張るのをやめる関数
   */
  watch(callback) {
    return watchUserDictionary((stored) => {
      callback(toUserDictionary(stored.entries));
    });
  },
};
