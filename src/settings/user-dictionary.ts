// 直した読み（利用者の辞書）を保存する。ふだんは storage.sync に、1つのキーの上限を超えないよう分けて入れ、
// 同じ Google アカウントの Chrome に同期する。多くなって storage.sync に入らないときは、storage.local に移す
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';

import { toEntry, type UserDictionaryEntry } from './dictionary-entry';

/** storage.sync の目次のキー。分けた数と書いたときの印を入れる。設定のキー（SETTING_KEYS）とは重ならない */
export const DICTIONARY_INDEX_KEY = 'userDictionary';

/** storage.sync の、分けた中身のキーの頭。後ろに 0 からの番号を付ける */
export const DICTIONARY_CHUNK_PREFIX = 'userDictionary.';

/** storage.local に移したときのキー */
export const DICTIONARY_LOCAL_KEY = 'userDictionary';

/** 1つのキーに入れる量の上限（バイト。キーを含む）。storage.sync の1つのキーの上限 8192 より少し小さくする */
export const CHUNK_MAX_BYTES = 8000;

/** storage.sync に入れる直した読みの量の上限（バイト）。storage.sync 全体の上限 102400 から、設定と余裕を残す */
export const SYNC_MAX_BYTES = 80_000;

/** 直した読みを保存している場所。local なら、ほかの Chrome には共有されない */
export type DictionaryArea = 'sync' | 'local';

/** 保存してある直した読み */
export interface StoredUserDictionary {
  /** 直した読み（足した順） */
  readonly entries: readonly UserDictionaryEntry[];
  /** 保存している場所 */
  readonly area: DictionaryArea;
}

/** storage.sync の目次 */
interface DictionaryIndex {
  /** 書いたときの印。中身と目次が同じときに書いたものかを確かめる */
  readonly revision: string;
  /** 分けた数 */
  readonly chunkCount: number;
}

/** storage.sync に分けて入れた中身の1つ */
interface DictionaryChunk {
  /** 書いたときの印（目次と同じ） */
  readonly revision: string;
  /** 言葉と読みの組 */
  readonly entries: readonly (readonly [string, string])[];
}

type StorageChangeListener = Parameters<typeof browser.storage.onChanged.addListener>[0];

const log = createLogger('settings');

const encoder = new TextEncoder();

/**
 * 保存してある直した読みを読む。決まりに合わない1件や、読めない中身は飛ばす。
 * @returns 直した読みと、保存している場所（throw しない限り、壊れた値があっても読める分を返す）
 */
export async function getUserDictionary(): Promise<StoredUserDictionary> {
  const local = await browser.storage.local.get(DICTIONARY_LOCAL_KEY);
  const moved: unknown = local[DICTIONARY_LOCAL_KEY];
  if (moved !== undefined) {
    return { entries: parsePairs(isRecord(moved) ? moved.entries : undefined), area: 'local' };
  }
  return { entries: readChunks(await browser.storage.sync.get()), area: 'sync' };
}

/**
 * 直した読みを1件足す。同じ言葉があれば、その読みを置きかえる（並びの位置はそのまま）。
 * @param entry 足す1件（parseSurface・parseReading で確かめたもの）
 * @returns 保存したあとの直した読み
 */
export async function putUserDictionaryEntry(
  entry: UserDictionaryEntry,
): Promise<StoredUserDictionary> {
  if (toEntry([entry.surface, entry.reading]) === undefined) {
    throw new TypeError('決まりに合わない直した読みは保存しない');
  }
  const { entries } = await getUserDictionary();
  const index = entries.findIndex(({ surface }) => surface === entry.surface);
  const next = index === -1 ? [...entries, entry] : entries.with(index, entry);
  return { entries: next, area: await saveEntries(next) };
}

/**
 * 直した読みを1件消す（読みを元に戻す）。
 * @param surface 消す言葉
 * @returns 保存したあとの直した読み
 */
export async function removeUserDictionaryEntry(surface: string): Promise<StoredUserDictionary> {
  const { entries } = await getUserDictionary();
  const next = entries.filter((entry) => entry.surface !== surface);
  return { entries: next, area: await saveEntries(next) };
}

/**
 * 直した読みが変わるのを見張る。ほかの画面や、同期したほかの Chrome で変わったときも呼ぶ。
 * 中身の変わらない書きかえ（使わなくなった中身の片付けなど）では呼ばない。
 * @param callback 変わったあとの直した読みを受け取る
 * @returns 見張るのをやめる関数
 */
export function watchUserDictionary(
  callback: (dictionary: StoredUserDictionary) => void,
): () => void {
  let last: string | undefined;
  const listener: StorageChangeListener = (changes, area) => {
    const isRelated =
      area === 'local'
        ? DICTIONARY_LOCAL_KEY in changes
        : area === 'sync' && Object.keys(changes).some(isSyncDictionaryKey);
    if (!isRelated) {
      return;
    }
    getUserDictionary()
      .then((dictionary) => {
        const current = JSON.stringify(dictionary);
        if (current !== last) {
          last = current;
          callback(dictionary);
        }
      })
      .catch((error: unknown) => {
        log.error('変わった直した読みを読むのに失敗しました', error);
      });
  };
  browser.storage.onChanged.addListener(listener);
  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}

/**
 * storage.sync に入れる形（目次と、分けた中身）を作る。
 * 1つの中身は、キーを含めて CHUNK_MAX_BYTES を超えないようにする。
 * @param entries 直した読み
 * @param revision 書いたときの印
 * @returns キーと値の組
 */
export function toSyncItems(
  entries: readonly UserDictionaryEntry[],
  revision: string,
): Record<string, unknown> {
  const chunks: (readonly [string, string])[][] = [];
  let current: (readonly [string, string])[] = [];
  let currentBytes = itemBytes(chunkKey(0), { revision, entries: [] });
  for (const { surface, reading } of entries) {
    const pair = [surface, reading] as const;
    const pairBytes = byteLength(JSON.stringify(pair));
    // 2件めからは、前との区切りの「,」の分が増える
    if (current.length > 0 && currentBytes + 1 + pairBytes > CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = itemBytes(chunkKey(chunks.length), { revision, entries: [] });
    }
    currentBytes += (current.length > 0 ? 1 : 0) + pairBytes;
    current.push(pair);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  const items: Record<string, DictionaryChunk | DictionaryIndex> = {};
  for (const [at, chunk] of chunks.entries()) {
    items[chunkKey(at)] = { revision, entries: chunk };
  }
  items[DICTIONARY_INDEX_KEY] = { revision, chunkCount: chunks.length };
  return items;
}

/**
 * storage が数える1つのキーの量（キーと、値を JSON にした文字列のバイト数）。
 * @param key キー
 * @param value 値
 * @returns バイト数
 */
export function itemBytes(key: string, value: unknown): number {
  return byteLength(key) + byteLength(JSON.stringify(value));
}

/**
 * 直した読みを保存する。storage.sync に入る量なら storage.sync に、入らなければ storage.local に入れる。
 * storage.sync には目次と中身を1回で書き、読む側が書きかけの並びを見ないようにする。
 * storage.local に移すときは、storage.sync の前の中身を消さない（同期しているほかの Chrome から消えないように）。
 * @param entries 直した読み
 * @returns 保存した場所
 */
async function saveEntries(entries: readonly UserDictionaryEntry[]): Promise<DictionaryArea> {
  const items = toSyncItems(entries, crypto.randomUUID());
  const total = Object.entries(items).reduce((sum, [key, value]) => sum + itemBytes(key, value), 0);
  if (total <= SYNC_MAX_BYTES) {
    try {
      await browser.storage.sync.set(items);
      await browser.storage.local.remove(DICTIONARY_LOCAL_KEY);
      await removeStaleChunks(new Set(Object.keys(items)));
      return 'sync';
    } catch (error) {
      log.error(
        '直した読みを storage.sync に保存できないため、このパソコンだけに保存します',
        error,
      );
    }
  }
  await browser.storage.local.set({
    [DICTIONARY_LOCAL_KEY]: { entries: entries.map(({ surface, reading }) => [surface, reading]) },
  });
  return 'local';
}

/**
 * 前に書いた中身のうち、今の目次で使わないものを消す。
 * @param current 今書いたキー
 */
async function removeStaleChunks(current: ReadonlySet<string>): Promise<void> {
  const stale = Object.keys(await browser.storage.sync.get()).filter(
    (key) => key.startsWith(DICTIONARY_CHUNK_PREFIX) && !current.has(key),
  );
  if (stale.length > 0) {
    await browser.storage.sync.remove(stale);
  }
}

/**
 * storage.sync の目次と中身から、直した読みを読む。印の合わない中身（同期の途中や、壊れたもの）は飛ばす。
 * @param stored storage.sync の値すべて
 * @returns 直した読み
 */
function readChunks(stored: Readonly<Record<string, unknown>>): UserDictionaryEntry[] {
  const index = stored[DICTIONARY_INDEX_KEY];
  if (index === undefined) {
    return [];
  }
  if (!isIndex(index)) {
    log.warn('直した読みの目次が読めないため、直した読みはないものとして扱います');
    return [];
  }
  const pairs: unknown[] = [];
  for (let at = 0; at < index.chunkCount; at += 1) {
    const chunk = stored[chunkKey(at)];
    if (!isRecord(chunk) || chunk.revision !== index.revision || !Array.isArray(chunk.entries)) {
      log.warn('直した読みの一部が読めないため、その分を飛ばします');
      continue;
    }
    pairs.push(...(chunk.entries as unknown[]));
  }
  return parsePairs(pairs);
}

/**
 * 言葉と読みの組の並びから、決まりに合うものだけを取り出す。同じ言葉が何度もあれば、後のほうの読みを使う。
 * @param value 組の並びのつもりの値
 * @returns 直した読み
 */
function parsePairs(value: unknown): UserDictionaryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries = new Map<string, UserDictionaryEntry>();
  let skipped = 0;
  for (const pair of value as unknown[]) {
    const entry = toEntry(pair);
    if (entry === undefined) {
      skipped += 1;
    } else {
      entries.set(entry.surface, entry);
    }
  }
  if (skipped > 0) {
    log.warn(`決まりに合わない直した読みを ${String(skipped)} 件飛ばしました`);
  }
  return [...entries.values()];
}

/**
 * storage.sync の、直した読みのキーか。
 * @param key キー
 * @returns 目次か中身のキーなら true
 */
function isSyncDictionaryKey(key: string): boolean {
  return key === DICTIONARY_INDEX_KEY || key.startsWith(DICTIONARY_CHUNK_PREFIX);
}

/**
 * 分けた中身のキーを作る。
 * @param at 何番め（0 から）
 * @returns キー
 */
function chunkKey(at: number): string {
  return `${DICTIONARY_CHUNK_PREFIX}${String(at)}`;
}

/**
 * 目次の形か。
 * @param value 確かめるもの
 * @returns 目次なら true
 */
function isIndex(value: unknown): value is DictionaryIndex {
  return (
    isRecord(value) &&
    typeof value.revision === 'string' &&
    typeof value.chunkCount === 'number' &&
    Number.isInteger(value.chunkCount) &&
    value.chunkCount >= 0
  );
}

/**
 * 中身を名前で引けるもの（配列でないオブジェクト）か。
 * @param value 確かめるもの
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 文字列を UTF-8 にしたときのバイト数。
 * @param text 文字列
 * @returns バイト数
 */
function byteLength(text: string): number {
  return encoder.encode(text).length;
}
