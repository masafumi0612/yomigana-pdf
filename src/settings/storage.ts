// 設定を storage.sync に読み書きする。項目ごとに別のキーに入れ、同じ Google アカウントの Chrome に同期する
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';

import { migrateStored, SCHEMA_VERSION, SCHEMA_VERSION_KEY } from './migrate';
import { DEFAULT_SETTINGS, SETTING_KEYS, type SettingKey, type Settings } from './model';
import { parseSettings } from './validate';

type StorageChangeListener = Parameters<typeof browser.storage.onChanged.addListener>[0];

const log = createLogger('settings');

/**
 * 設定を読む。ない値・形の合わない値は、その項目だけ既定にする。
 * 古い版の拡張が保存した値は、今の形に直して保存し直す。直せないときは、保存してある値を消さずに残し、既定を返す。
 * @returns 設定（保存してある値が壊れていても throw しない）
 */
export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get([...SETTING_KEYS, SCHEMA_VERSION_KEY]);
  const migrated = migrateStored(stored);
  if (!migrated.ok) {
    log.warn(`保存してある設定を今の形に直せないため、既定を使います（${migrated.error}）`);
    return DEFAULT_SETTINGS;
  }
  const { values, isMigrated } = migrated.value;
  if (isMigrated) {
    await browser.storage.sync.set({
      ...pickSettingValues(values),
      [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
    });
  }
  return parseSettings(values);
}

/**
 * 渡した項目だけを保存する。ほかの項目には触らない。
 * @param update 変える項目と、その値
 */
export async function updateSettings(update: Partial<Settings>): Promise<void> {
  // 古い版の値が残っていたら、今の形の値と混ざらないよう、先に直しておく
  await getSettings();
  const values = pickSettingValues(update);
  if (Object.keys(values).length > 0) {
    await browser.storage.sync.set(values);
  }
}

/**
 * すべての設定を既定に戻す。設定のキー（SETTING_KEYS）だけを書き、
 * 利用者の辞書など、ほかのキーに入れたものは消さない。
 */
export async function resetSettings(): Promise<void> {
  await browser.storage.sync.set({ ...DEFAULT_SETTINGS, [SCHEMA_VERSION_KEY]: SCHEMA_VERSION });
}

/**
 * 設定が変わるのを見張る。ほかの画面や、同期したほかの Chrome で変わったときも呼ぶ。
 * @param callback 設定のどれかが変わったときに、変わったあとの設定すべてを受け取る
 * @returns 見張るのをやめる関数
 */
export function watchSettings(callback: (settings: Settings) => void): () => void {
  const listener: StorageChangeListener = (changes, area) => {
    if (area !== 'sync' || !SETTING_KEYS.some((key) => key in changes)) {
      return;
    }
    getSettings()
      .then(callback)
      .catch((error: unknown) => {
        log.error('変わった設定を読むのに失敗しました', error);
      });
  };
  browser.storage.onChanged.addListener(listener);
  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}

/**
 * 設定のキーで、値のあるものだけを取り出す。
 * @param values 取り出すもと
 * @returns 設定のキーと値だけのもの
 */
function pickSettingValues(values: Partial<Record<SettingKey, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    SETTING_KEYS.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]),
  );
}
