// 保存の形を変えたときに、古い版の拡張が保存した値を今の形に直す
import type { Result } from '@/result';

/** 今の保存の形の版。形を変えたら1つ上げ、直す処理を MIGRATIONS に足す */
export const SCHEMA_VERSION = 1;

/** 保存の形の版を入れるキー */
export const SCHEMA_VERSION_KEY = 'schemaVersion';

/** `storage.sync` から読んだ値 */
export type StoredValues = Readonly<Record<string, unknown>>;

/**
 * 1つ前の版の値を、次の版の値に直す処理。直せないときは throw してよい。
 * @param stored 直す前の値
 * @returns 直した値
 */
export type Migration = (stored: StoredValues) => StoredValues;

/** 版ごとの直す処理。キーは直す前の版。版 1 が最初なので、まだない */
export const MIGRATIONS: ReadonlyMap<number, Migration> = new Map();

/** 直した結果 */
export interface Migrated {
  /** 今の版の形の値 */
  readonly values: StoredValues;
  /** 古い版から直したなら true（保存し直す） */
  readonly isMigrated: boolean;
}

/** 直せなかった理由。版の値が壊れている（invalid-version）、直す処理がないか失敗した（migration-failed） */
export type MigrationError = 'invalid-version' | 'migration-failed';

/**
 * 保存してある値を、今の版の形に直す。版がないときは版 1 とみなす。
 * 今より新しい版（新しい拡張が同期した値など）は、そのまま返す（読むときに項目ごとに確かめる）。
 * @param stored 保存してある値
 * @param migrations 版ごとの直す処理
 * @param currentVersion 今の版
 * @returns 直した値か、直せなかった理由
 */
export function migrateStored(
  stored: StoredValues,
  migrations: ReadonlyMap<number, Migration> = MIGRATIONS,
  currentVersion: number = SCHEMA_VERSION,
): Result<Migrated, MigrationError> {
  const version: unknown = stored[SCHEMA_VERSION_KEY] ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'invalid-version' };
  }
  let values = stored;
  try {
    for (let from = version; from < currentVersion; from += 1) {
      const migration = migrations.get(from);
      if (migration === undefined) {
        return { ok: false, error: 'migration-failed' };
      }
      values = migration(values);
    }
  } catch {
    return { ok: false, error: 'migration-failed' };
  }
  return { ok: true, value: { values, isMigrated: version < currentVersion } };
}
