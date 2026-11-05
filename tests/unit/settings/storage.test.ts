import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS } from '@/settings/model';
import { getSettings, resetSettings, updateSettings, watchSettings } from '@/settings/storage';

/** 設定でないキー（利用者の辞書など）のつもり */
const OTHER_KEY = 'userDictionary';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getSettings', () => {
  it('まだ何も保存していないとき、既定になる', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('前の版で親スイッチをオンにしていたとき、オンで読める', async () => {
    await fakeBrowser.storage.sync.set({ autoRedirect: true });

    expect((await getSettings()).autoRedirect).toBe(true);
  });

  it('形の合わない値があるとき、その項目だけ既定になる', async () => {
    await fakeBrowser.storage.sync.set({ autoRedirect: 'yes', level: 'g3' });

    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, level: 'g3' });
  });

  it('版が壊れていて直せないとき、既定を使い、保存してある値は消さない', async () => {
    const stored = { schemaVersion: 'abc', level: 'g3' };
    await fakeBrowser.storage.sync.set(stored);

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await fakeBrowser.storage.sync.get()).toEqual(stored);
  });
});

describe('updateSettings', () => {
  it('項目を1つ渡したとき、その項目のキーだけを書く', async () => {
    await updateSettings({ level: 'g2' });

    expect(await fakeBrowser.storage.sync.get()).toEqual({ level: 'g2' });
  });

  it('値が undefined の項目は書かない', async () => {
    await fakeBrowser.storage.sync.set({ level: 'g3' });

    await updateSettings({ level: undefined, autoRedirect: true });

    expect(await fakeBrowser.storage.sync.get()).toEqual({ level: 'g3', autoRedirect: true });
  });
});

describe('resetSettings', () => {
  it('変えた設定があるとき、既定に戻る', async () => {
    await updateSettings({ level: 'g2', autoRedirect: true });

    await resetSettings();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('設定でないキーがあるとき、そのキーには触らない', async () => {
    await fakeBrowser.storage.sync.set({ [OTHER_KEY]: [['林', 'はやし']] });

    await resetSettings();

    expect((await fakeBrowser.storage.sync.get(OTHER_KEY))[OTHER_KEY]).toEqual([['林', 'はやし']]);
  });
});

describe('watchSettings', () => {
  it('設定が変わったとき、変わったあとの設定すべてを受け取る', async () => {
    await fakeBrowser.storage.sync.set({ autoRedirect: true });
    const callback = vi.fn();
    watchSettings(callback);

    await updateSettings({ level: 'g4' });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        autoRedirect: true,
        level: 'g4',
      });
    });
  });

  it('設定でないキーが変わったとき、呼ばない', async () => {
    const callback = vi.fn();
    watchSettings(callback);

    await fakeBrowser.storage.sync.set({ [OTHER_KEY]: [] });
    await updateSettings({ level: 'g4' });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalled();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('sync でない保存先が変わったとき、呼ばない', async () => {
    const callback = vi.fn();
    watchSettings(callback);

    await fakeBrowser.storage.local.set({ level: 'g1' });
    await updateSettings({ level: 'g4' });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalled();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('見張るのをやめたとき、呼ばない', async () => {
    const stopped = vi.fn();
    const watching = vi.fn();
    const unwatch = watchSettings(stopped);
    watchSettings(watching);

    unwatch();
    await updateSettings({ level: 'g4' });

    await vi.waitFor(() => {
      expect(watching).toHaveBeenCalled();
    });
    expect(stopped).not.toHaveBeenCalled();
  });
});
