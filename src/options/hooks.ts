// 設定の画面で、保存した設定や Chrome の許可の状態を見張る
import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import type { Settings } from '@/settings/model';
import { getSettings, watchSettings } from '@/settings/storage';
import {
  getUserDictionary,
  type StoredUserDictionary,
  watchUserDictionary,
} from '@/settings/user-dictionary';

import { ALL_SITES } from './auto-redirect';
import { type JumpTarget, takeJump, watchJump } from './jump';

const log = createLogger('options');

/**
 * 保存した設定を読み、ほかの画面や同期したほかの Chrome で変わったら読み直す。
 * @returns 設定。読み終わるまでは undefined
 */
export function useSettings(): Settings | undefined {
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  useEffect(() => {
    const stop = watchSettings(setSettings);
    getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        log.error('設定を読むのに失敗しました', error);
      });
    return stop;
  }, []);
  return settings;
}

/**
 * 保存してある直した読みを読み、ほかの画面や同期したほかの Chrome で変わったら読み直す。
 * @returns 直した読みと保存している場所。読み終わるまでは undefined
 */
export function useUserDictionary(): StoredUserDictionary | undefined {
  const [dictionary, setDictionary] = useState<StoredUserDictionary | undefined>(undefined);
  useEffect(() => {
    const stop = watchUserDictionary(setDictionary);
    getUserDictionary()
      .then(setDictionary)
      .catch((error: unknown) => {
        log.error('直した読みを読むのに失敗しました', error);
      });
    return stop;
  }, []);
  return dictionary;
}

/**
 * すべてのサイトを読む権限があるかを調べ、Chrome の設定で変わったら調べ直す。
 * @returns 権限があるなら true。調べ終わるまでは false
 */
export function useHostAccess(): boolean {
  const [hasHostAccess, setHasHostAccess] = useState(false);
  useEffect(() => {
    const check = (): void => {
      browser.permissions
        .contains(ALL_SITES)
        .then(setHasHostAccess)
        .catch((error: unknown) => {
          log.error('サイトを読む権限を調べるのに失敗しました', error);
        });
    };
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, []);
  return hasHostAccess;
}

/**
 * ファイルの URL へのアクセスが許可されているかを調べる。
 * 許可は Chrome の拡張機能の画面で変えるので、この画面に戻ってきたときに調べ直す。
 * @returns 許可されているなら true。調べ終わるまでは undefined
 */
export function useFileSchemeAccess(): boolean | undefined {
  const [isAllowed, setIsAllowed] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const check = (): void => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      browser.extension
        .isAllowedFileSchemeAccess()
        .then(setIsAllowed)
        .catch((error: unknown) => {
          log.error('ファイルの URL へのアクセスを調べるのに失敗しました', error);
        });
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return isAllowed;
}

/**
 * 画面の要素を覚えておく。Preact の ref は外したときに null を渡すので、undefined に直して持つ。
 * @returns 覚えた要素と、要素の ref に渡す関数
 */
export function useElement<T extends HTMLElement>(): [
  RefObject<T | undefined>,
  (element: T | null) => void,
] {
  const element = useRef<T | undefined>(undefined);
  const setElement = useRef((value: T | null) => {
    element.current = value ?? undefined;
  });
  return [element, setElement.current];
}

/**
 * 開いた側が残した「上に出す場所」を読み、もう開いている画面に移ってきたときも読み直す。
 * @returns 上に出す場所（なければ undefined）と、出し終えたことを伝える関数
 */
export function useJumpTarget(): [JumpTarget | undefined, () => void] {
  const [target, setTarget] = useState<JumpTarget | undefined>(undefined);
  useEffect(() => {
    const take = (): void => {
      takeJump()
        .then((next) => {
          if (next !== undefined) {
            setTarget(next);
          }
        })
        .catch((error: unknown) => {
          log.error('上に出す場所を読むのに失敗しました', error);
        });
    };
    const stop = watchJump(take);
    take();
    return stop;
  }, []);
  const finish = useCallback(() => {
    setTarget(undefined);
  }, []);
  return [target, finish];
}
