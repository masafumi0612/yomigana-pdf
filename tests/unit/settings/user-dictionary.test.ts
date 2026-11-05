import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { UserDictionaryEntry } from '@/settings/dictionary-entry';
import { SCHEMA_VERSION_KEY } from '@/settings/migrate';
import { SETTING_KEYS } from '@/settings/model';
import { resetSettings, updateSettings } from '@/settings/storage';
import {
  CHUNK_MAX_BYTES,
  DICTIONARY_CHUNK_PREFIX,
  DICTIONARY_INDEX_KEY,
  DICTIONARY_LOCAL_KEY,
  getUserDictionary,
  itemBytes,
  putUserDictionaryEntry,
  removeUserDictionaryEntry,
  SYNC_MAX_BYTES,
  toSyncItems,
  watchUserDictionary,
} from '@/settings/user-dictionary';

/** storage.sync の1つのキーの上限（バイト。キーを含む） */
const SYNC_ITEM_QUOTA = 8192;

const HAYASHI: UserDictionaryEntry = { surface: '林', reading: 'はやし' };
const TAKANASHI: UserDictionaryEntry = { surface: '小鳥遊', reading: 'たかなし' };

/**
 * 長い言葉と読みの組を作る（1件で 200 バイトほど。4バイトの字 𠮟 を含む）。
 * @param count 作る数
 * @returns 言葉の違う組
 */
function longEntries(count: number): UserDictionaryEntry[] {
  return Array.from({ length: count }, (_, at) => ({
    surface: `𠮟${String.fromCodePoint(0x4e00 + at)}${'漢'.repeat(18)}`,
    reading: 'あ'.repeat(40),
  }));
}

/**
 * storage.sync に、直した読みを今の形で書いておく。
 * @param entries 直した読み
 */
async function seedSync(entries: readonly UserDictionaryEntry[]): Promise<void> {
  await fakeBrowser.storage.sync.set(toSyncItems(entries, 'seed'));
}

/**
 * storage.sync に入れるときの量を数える。
 * @param entries 直した読み
 * @returns 目次と中身のバイト数の合計
 */
function syncBytes(entries: readonly UserDictionaryEntry[]): number {
  return Object.entries(toSyncItems(entries, crypto.randomUUID())).reduce(
    (sum, [key, value]) => sum + itemBytes(key, value),
    0,
  );
}

/**
 * storage.sync の、分けた中身のキーを挙げる。
 * @returns キー
 */
async function chunkKeys(): Promise<string[]> {
  return Object.keys(await fakeBrowser.storage.sync.get()).filter((key) =>
    key.startsWith(DICTIONARY_CHUNK_PREFIX),
  );
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getUserDictionary', () => {
  it('まだ何も保存していないとき、空で storage.sync になる', async () => {
    expect(await getUserDictionary()).toEqual({ entries: [], area: 'sync' });
  });

  it('目次が壊れているとき、throw せずに空になる', async () => {
    await fakeBrowser.storage.sync.set({ [DICTIONARY_INDEX_KEY]: [['林', 'はやし']] });

    expect(await getUserDictionary()).toEqual({ entries: [], area: 'sync' });
  });

  it('中身の1つの印が目次と合わないとき、その中身だけ飛ばす', async () => {
    const entries = longEntries(80);
    await seedSync(entries);
    const keys = await chunkKeys();
    expect(keys.length).toBeGreaterThan(1);
    const first = (await fakeBrowser.storage.sync.get(`${DICTIONARY_CHUNK_PREFIX}0`))[
      `${DICTIONARY_CHUNK_PREFIX}0`
    ] as { entries: unknown[] };
    await fakeBrowser.storage.sync.set({
      [`${DICTIONARY_CHUNK_PREFIX}0`]: { ...first, revision: 'other' },
    });

    const { entries: read } = await getUserDictionary();

    expect(read).toEqual(entries.slice(first.entries.length));
  });

  it('中身の1つが壊れているとき、その中身だけ飛ばす', async () => {
    const entries = longEntries(80);
    await seedSync(entries);
    const first = (await fakeBrowser.storage.sync.get(`${DICTIONARY_CHUNK_PREFIX}0`))[
      `${DICTIONARY_CHUNK_PREFIX}0`
    ] as { entries: unknown[] };
    await fakeBrowser.storage.sync.set({ [`${DICTIONARY_CHUNK_PREFIX}0`]: 'broken' });

    expect((await getUserDictionary()).entries).toEqual(entries.slice(first.entries.length));
  });

  it('中身が足りないとき、ある分だけを読む', async () => {
    await seedSync([HAYASHI]);
    await fakeBrowser.storage.sync.set({
      [DICTIONARY_INDEX_KEY]: { revision: 'seed', chunkCount: 2 },
    });

    expect((await getUserDictionary()).entries).toEqual([HAYASHI]);
  });

  it('決まりに合わない1件があるとき、その1件だけ飛ばす', async () => {
    await fakeBrowser.storage.sync.set({
      [DICTIONARY_INDEX_KEY]: { revision: 'r', chunkCount: 1 },
      [`${DICTIONARY_CHUNK_PREFIX}0`]: {
        revision: 'r',
        entries: [
          ['林', 'はやし'],
          ['森', 'モリ'],
          ['かな', 'かな'],
          ['木'],
          3,
          ['小鳥遊', 'たかなし'],
        ],
      },
    });

    expect((await getUserDictionary()).entries).toEqual([HAYASHI, TAKANASHI]);
  });

  it('同じ言葉が2つあるとき、後のほうの読みを使う', async () => {
    await fakeBrowser.storage.sync.set({
      [DICTIONARY_INDEX_KEY]: { revision: 'r', chunkCount: 1 },
      [`${DICTIONARY_CHUNK_PREFIX}0`]: {
        revision: 'r',
        entries: [
          ['林', 'りん'],
          ['林', 'はやし'],
        ],
      },
    });

    expect((await getUserDictionary()).entries).toEqual([HAYASHI]);
  });

  it('storage.local に移してあるとき、storage.local の中身を読む', async () => {
    await seedSync([TAKANASHI]);
    await fakeBrowser.storage.local.set({
      [DICTIONARY_LOCAL_KEY]: { entries: [['林', 'はやし']] },
    });

    expect(await getUserDictionary()).toEqual({ entries: [HAYASHI], area: 'local' });
  });

  it('storage.local の中身が壊れているとき、throw せずに空になる', async () => {
    await fakeBrowser.storage.local.set({ [DICTIONARY_LOCAL_KEY]: 'broken' });

    expect(await getUserDictionary()).toEqual({ entries: [], area: 'local' });
  });
});

describe('putUserDictionaryEntry', () => {
  it('足したとき、足した順に読める', async () => {
    await putUserDictionaryEntry(HAYASHI);
    await putUserDictionaryEntry(TAKANASHI);

    expect(await getUserDictionary()).toEqual({ entries: [HAYASHI, TAKANASHI], area: 'sync' });
  });

  it('同じ言葉を足したとき、読みを置きかえ、並びの位置は変えない', async () => {
    await putUserDictionaryEntry(HAYASHI);
    await putUserDictionaryEntry(TAKANASHI);

    await putUserDictionaryEntry({ surface: '林', reading: 'りん' });

    expect((await getUserDictionary()).entries).toEqual([
      { surface: '林', reading: 'りん' },
      TAKANASHI,
    ]);
  });

  it('決まりに合わない1件を渡したとき、保存せずに throw する', async () => {
    await expect(putUserDictionaryEntry({ surface: '林', reading: 'ハヤシ' })).rejects.toThrow(
      TypeError,
    );
    expect(await fakeBrowser.storage.sync.get()).toEqual({});
  });

  it('設定のキーや版のキーには書かない', async () => {
    await putUserDictionaryEntry(HAYASHI);

    const keys = Object.keys(await fakeBrowser.storage.sync.get());
    expect(keys.filter((key) => [...SETTING_KEYS, SCHEMA_VERSION_KEY].includes(key))).toEqual([]);
  });

  it('storage.sync に入らない量になったとき、storage.local に移し、storage.sync の前の中身は残す', async () => {
    const all = longEntries(600);
    let fitting = 0;
    while (syncBytes(all.slice(0, fitting + 1)) <= SYNC_MAX_BYTES) fitting += 1;
    await seedSync(all.slice(0, fitting));
    const before = await fakeBrowser.storage.sync.get();
    const [next] = all.slice(fitting);
    if (next === undefined) throw new Error('足す1件がない');

    const stored = await putUserDictionaryEntry(next);

    expect(stored).toEqual({ entries: all.slice(0, fitting + 1), area: 'local' });
    expect(await getUserDictionary()).toEqual(stored);
    expect(await fakeBrowser.storage.sync.get()).toEqual(before);
  });

  it('storage.sync に入る量のうちは、storage.sync に保存する', async () => {
    const all = longEntries(600);
    let fitting = 0;
    while (syncBytes(all.slice(0, fitting + 1)) <= SYNC_MAX_BYTES) fitting += 1;
    await seedSync(all.slice(0, fitting - 1));
    const [last] = all.slice(fitting - 1);
    if (last === undefined) throw new Error('足す1件がない');

    const stored = await putUserDictionaryEntry(last);

    expect(stored).toEqual({ entries: all.slice(0, fitting), area: 'sync' });
  });

  it('storage.sync に書けないとき、storage.local に保存する', async () => {
    vi.spyOn(fakeBrowser.storage.sync, 'set').mockRejectedValueOnce(new Error('QUOTA'));

    const stored = await putUserDictionaryEntry(HAYASHI);

    expect(stored).toEqual({ entries: [HAYASHI], area: 'local' });
    expect(await getUserDictionary()).toEqual(stored);
  });
});

describe('removeUserDictionaryEntry', () => {
  it('消したとき、その1件だけがなくなる', async () => {
    await putUserDictionaryEntry(HAYASHI);
    await putUserDictionaryEntry(TAKANASHI);

    await removeUserDictionaryEntry('林');

    expect((await getUserDictionary()).entries).toEqual([TAKANASHI]);
  });

  it('減って中身の数が減ったとき、使わなくなった中身のキーを消す', async () => {
    await seedSync(longEntries(80));
    expect((await chunkKeys()).length).toBeGreaterThan(1);
    const [first] = longEntries(1);

    for (const entry of longEntries(80).slice(1)) {
      await removeUserDictionaryEntry(entry.surface);
    }

    expect(await chunkKeys()).toEqual([`${DICTIONARY_CHUNK_PREFIX}0`]);
    expect((await getUserDictionary()).entries).toEqual([first]);
  });

  it('storage.local に移したあと、storage.sync に入る量まで減ったとき、storage.sync に戻す', async () => {
    await fakeBrowser.storage.local.set({
      [DICTIONARY_LOCAL_KEY]: {
        entries: [
          ['林', 'はやし'],
          ['小鳥遊', 'たかなし'],
        ],
      },
    });

    const stored = await removeUserDictionaryEntry('小鳥遊');

    expect(stored).toEqual({ entries: [HAYASHI], area: 'sync' });
    expect(await fakeBrowser.storage.local.get()).toEqual({});
    expect(await getUserDictionary()).toEqual(stored);
  });
});

describe('toSyncItems', () => {
  it('どの中身も、キーを含めて storage.sync の1つのキーの上限に収まる', () => {
    const items = toSyncItems(longEntries(300), 'r');

    for (const [key, value] of Object.entries(items)) {
      expect(itemBytes(key, value)).toBeLessThanOrEqual(CHUNK_MAX_BYTES);
    }
    expect(CHUNK_MAX_BYTES).toBeLessThan(SYNC_ITEM_QUOTA);
  });

  it('中身を分けるとき、次の1件が入らないところで分ける', () => {
    const items = toSyncItems(longEntries(300), 'r');
    const first = items[`${DICTIONARY_CHUNK_PREFIX}0`] as {
      revision: string;
      entries: (readonly [string, string])[];
    };
    const second = items[`${DICTIONARY_CHUNK_PREFIX}1`] as typeof first;
    const next = second.entries[0];
    if (next === undefined) throw new Error('2つめの中身がない');

    const withNext = { ...first, entries: [...first.entries, next] };

    expect(itemBytes(`${DICTIONARY_CHUNK_PREFIX}0`, withNext)).toBeGreaterThan(CHUNK_MAX_BYTES);
  });

  it('マルチバイトの字を数えるとき、文字の数ではなくバイト数で分ける', () => {
    const ascii = toSyncItems(
      Array.from({ length: 300 }, (_, at) => ({
        surface: `漢${String(at).padStart(9, '0')}`,
        reading: 'か',
      })),
      'r',
    );
    const wide = toSyncItems(
      Array.from({ length: 300 }, (_, at) => ({
        surface: `漢${String.fromCodePoint(0x4e00 + at).repeat(9)}`,
        reading: 'か',
      })),
      'r',
    );

    expect(wide[DICTIONARY_INDEX_KEY]).toEqual({ revision: 'r', chunkCount: 2 });
    expect(ascii[DICTIONARY_INDEX_KEY]).toEqual({ revision: 'r', chunkCount: 1 });
  });

  it('空のとき、中身はなく、目次だけになる', () => {
    expect(toSyncItems([], 'r')).toEqual({
      [DICTIONARY_INDEX_KEY]: { revision: 'r', chunkCount: 0 },
    });
  });
});

describe('watchUserDictionary', () => {
  it('足したとき、変わったあとの直した読みを受け取る', async () => {
    const callback = vi.fn();
    watchUserDictionary(callback);

    await putUserDictionaryEntry(HAYASHI);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ entries: [HAYASHI], area: 'sync' });
    });
  });

  it('設定だけが変わったとき、呼ばない', async () => {
    const callback = vi.fn();
    watchUserDictionary(callback);

    await updateSettings({ level: 'g4' });
    await putUserDictionaryEntry(HAYASHI);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalled();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('中身の変わらない書きかえのとき、もう一度は呼ばない', async () => {
    const callback = vi.fn();
    watchUserDictionary(callback);
    await putUserDictionaryEntry(HAYASHI);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });

    await fakeBrowser.storage.sync.set({ [`${DICTIONARY_CHUNK_PREFIX}5`]: 'stale' });
    await fakeBrowser.storage.sync.remove(`${DICTIONARY_CHUNK_PREFIX}5`);
    await putUserDictionaryEntry(TAKANASHI);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    expect(callback).toHaveBeenLastCalledWith({ entries: [HAYASHI, TAKANASHI], area: 'sync' });
  });

  it('storage.local に移したとき、移したことを受け取る', async () => {
    const callback = vi.fn();
    watchUserDictionary(callback);

    await fakeBrowser.storage.local.set({
      [DICTIONARY_LOCAL_KEY]: { entries: [['林', 'はやし']] },
    });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ entries: [HAYASHI], area: 'local' });
    });
  });

  it('見張るのをやめたとき、呼ばない', async () => {
    const stopped = vi.fn();
    const watching = vi.fn();
    const unwatch = watchUserDictionary(stopped);
    watchUserDictionary(watching);

    unwatch();
    await putUserDictionaryEntry(HAYASHI);

    await vi.waitFor(() => {
      expect(watching).toHaveBeenCalled();
    });
    expect(stopped).not.toHaveBeenCalled();
  });
});

describe('設定との関わり', () => {
  it('直した読みのキーは、設定のキーや版のキーと重ならない', () => {
    for (const key of [...SETTING_KEYS, SCHEMA_VERSION_KEY]) {
      expect(key === DICTIONARY_INDEX_KEY || key.startsWith(DICTIONARY_CHUNK_PREFIX)).toBe(false);
    }
  });

  it('設定を最初の状態に戻したとき、直した読みは残る', async () => {
    await putUserDictionaryEntry(HAYASHI);
    await updateSettings({ level: 'g3' });

    await resetSettings();

    expect(await getUserDictionary()).toEqual({ entries: [HAYASHI], area: 'sync' });
  });
});
