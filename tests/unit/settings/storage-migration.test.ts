import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type * as MigrateModule from '@/settings/migrate';
import { DEFAULT_SETTINGS } from '@/settings/model';
import { getSettings } from '@/settings/storage';

// 保存の形を版 2 に変えたことにする。版 1 では level を 'grade1' のように書いていたとみなす
vi.mock('@/settings/migrate', async (importOriginal) => {
  const original = await importOriginal<typeof MigrateModule>();
  const migrations = new Map([
    [1, (stored: Record<string, unknown>) => ({ ...stored, level: 'g1' })],
  ]);
  return {
    ...original,
    SCHEMA_VERSION: 2,
    migrateStored: (stored: Record<string, unknown>) =>
      original.migrateStored(stored, migrations, 2),
  };
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getSettings（保存の形を変えたあと）', () => {
  it('古い版の値があるとき、直した値を読む', async () => {
    await fakeBrowser.storage.sync.set({ level: 'grade1' });

    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, level: 'g1' });
  });

  it('古い版の値があるとき、直した値と今の版を保存し直す', async () => {
    await fakeBrowser.storage.sync.set({ level: 'grade1', userDictionary: [] });

    await getSettings();

    expect(await fakeBrowser.storage.sync.get()).toEqual({
      level: 'g1',
      schemaVersion: 2,
      userDictionary: [],
    });
  });

  it('今の版の値のとき、保存し直さない', async () => {
    await fakeBrowser.storage.sync.set({ level: 'g3', schemaVersion: 2 });
    const set = vi.spyOn(fakeBrowser.storage.sync, 'set');

    await getSettings();

    expect(set).not.toHaveBeenCalled();
  });
});
