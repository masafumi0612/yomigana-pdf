import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { AUTO_REDIRECT_STORAGE_KEY } from '@/config';
import { getAutoRedirect, setAutoRedirect } from '@/redirect/settings';

describe('親スイッチ', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('まだ保存していないとき、オフになる', async () => {
    expect(await getAutoRedirect()).toBe(false);
  });

  it('オンにして保存したとき、オンで読める', async () => {
    await setAutoRedirect(true);

    expect(await getAutoRedirect()).toBe(true);
  });

  it('保存した値が真偽値でないとき、オフになる', async () => {
    await fakeBrowser.storage.sync.set({ [AUTO_REDIRECT_STORAGE_KEY]: 'yes' });

    expect(await getAutoRedirect()).toBe(false);
  });
});
