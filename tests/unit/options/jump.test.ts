import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { isJumpTarget, requestJump, takeJump, watchJump } from '@/options/jump';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('isJumpTarget', () => {
  it('ルビの量の場所のとき、上に出せる', () => {
    expect(isJumpTarget('amount')).toBe(true);
  });

  it('値がないときや形の合わない値のとき、上に出さない', () => {
    expect(isJumpTarget(undefined)).toBe(false);
    expect(isJumpTarget('look')).toBe(false);
    expect(isJumpTarget(1)).toBe(false);
  });
});

describe('takeJump', () => {
  it('何も残していないとき、上に出す場所はない', async () => {
    expect(await takeJump()).toBeUndefined();
  });

  it('残した場所を読み、読んだあとは消える', async () => {
    await requestJump('amount');

    expect(await takeJump()).toBe('amount');
    expect(await takeJump()).toBeUndefined();
  });
});

describe('watchJump', () => {
  it('場所が残されたとき知らせ、やめたあとは知らせない', async () => {
    const onRequest = vi.fn();
    const stop = watchJump(onRequest);

    await requestJump('amount');
    expect(onRequest).toHaveBeenCalledTimes(1);

    await takeJump();
    expect(onRequest).toHaveBeenCalledTimes(1);

    stop();
    await requestJump('amount');
    expect(onRequest).toHaveBeenCalledTimes(1);
  });
});
