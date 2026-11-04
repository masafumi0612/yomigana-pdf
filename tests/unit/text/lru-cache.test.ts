import { describe, expect, it } from 'vitest';

import { LruCache } from '@/text/lru-cache';

describe('LruCache', () => {
  it('入れていない鍵のとき、undefined になる', () => {
    expect(new LruCache<string, number>(2).get('a')).toBeUndefined();
  });

  it('上限を超えたとき、いちばん長く使っていないものを消す', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([1, undefined, 3]);
  });

  it('同じ鍵を入れ直したとき、数は増えず、値が新しくなる', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('a', 2);
    expect([cache.size, cache.get('a')]).toEqual([1, 2]);
  });
});
