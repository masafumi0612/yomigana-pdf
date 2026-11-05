import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { putUserDictionaryEntry } from '@/settings/user-dictionary';
import { storedUserDictionary } from '@/viewer/user-dictionary-feed';

beforeEach(() => {
  fakeBrowser.reset();
  vi.useRealTimers();
});

describe('storedUserDictionary.load', () => {
  it('保存してあるとき、言葉から読みを引く表になる', async () => {
    await putUserDictionaryEntry({ surface: '林', reading: 'はやし' });

    expect(await storedUserDictionary.load()).toEqual(new Map([['林', 'はやし']]));
  });

  it('読めないとき、throw せずに空になる', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('broken'));

    expect(await storedUserDictionary.load()).toEqual(new Map());
  });

  it('読むのに時間がかかるとき、待たずに空になる', async () => {
    vi.useFakeTimers();
    // get は呼び方ごとの型がいくつもあり、最後の（コールバックで受け取る）形で推論されるため、Promise を返す形にする
    const get = vi.spyOn(fakeBrowser.storage.local, 'get') as unknown as MockInstance<
      () => Promise<Record<string, unknown>>
    >;
    get.mockReturnValueOnce(new Promise(() => undefined));

    const loading = storedUserDictionary.load();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await loading).toEqual(new Map());
  });
});

describe('storedUserDictionary.watch', () => {
  it('変わったとき、言葉から読みを引く表を受け取る', async () => {
    const callback = vi.fn();
    storedUserDictionary.watch(callback);

    await putUserDictionaryEntry({ surface: '林', reading: 'はやし' });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(new Map([['林', 'はやし']]));
    });
  });
});
