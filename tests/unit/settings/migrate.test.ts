import { describe, expect, it } from 'vitest';

import { migrateStored, type Migration, SCHEMA_VERSION } from '@/settings/migrate';

/** 版 1 の level の値の書き方を、版 2 で変えたことにする */
const toVersion2: Migration = (stored) => ({
  ...stored,
  level: stored.level === 'grade1' ? 'g1' : stored.level,
});
/** 版 2 から版 3 で、キーを1つ足したことにする */
const toVersion3: Migration = (stored) => ({ ...stored, added: true });

describe('migrateStored', () => {
  it('まだ保存の形を変えていないとき、今の版は 1 になる', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('版を保存していないとき、版 1 とみなして、そのまま返す', () => {
    const stored = { level: 'g3' };

    expect(migrateStored(stored)).toEqual({
      ok: true,
      value: { values: stored, isMigrated: false },
    });
  });

  it('古い版のとき、今の版まで順に直す', () => {
    const migrations = new Map([
      [1, toVersion2],
      [2, toVersion3],
    ]);

    expect(migrateStored({ schemaVersion: 1, level: 'grade1' }, migrations, 3)).toEqual({
      ok: true,
      value: { values: { schemaVersion: 1, level: 'g1', added: true }, isMigrated: true },
    });
  });

  it('今より新しい版のとき、そのまま返す', () => {
    const stored = { schemaVersion: 5, level: 'g3' };

    expect(migrateStored(stored)).toEqual({
      ok: true,
      value: { values: stored, isMigrated: false },
    });
  });

  it('直す処理が失敗したとき、migration-failed になる', () => {
    const failing: Migration = () => {
      throw new Error('直せない');
    };

    expect(migrateStored({ schemaVersion: 1 }, new Map([[1, failing]]), 2)).toEqual({
      ok: false,
      error: 'migration-failed',
    });
  });

  it('直す処理がない版のとき、migration-failed になる', () => {
    expect(migrateStored({ schemaVersion: 1 }, new Map(), 2)).toEqual({
      ok: false,
      error: 'migration-failed',
    });
  });

  it.each(['1', 0, 1.5])('版が %s のとき、invalid-version になる', (version) => {
    expect(migrateStored({ schemaVersion: version })).toEqual({
      ok: false,
      error: 'invalid-version',
    });
  });
});
