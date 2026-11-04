// 最近使ったものだけを、決まった数まで残すキャッシュ（メモリだけに置き、ディスクには書かない）

/**
 * 最近使ったものだけを残すキャッシュ。数が上限を超えたら、いちばん長く使っていないものから消す。
 * @typeParam Key 引くときの鍵
 * @typeParam Value 残す値
 */
export class LruCache<Key, Value> {
  // Map は入れた順に並ぶので、使うたびに入れ直して、頭をいちばん古いものにする
  private readonly entries = new Map<Key, Value>();

  /**
   * キャッシュを作る。
   * @param capacity 残す数の上限（1以上）
   */
  constructor(private readonly capacity: number) {}

  /**
   * 値を引く。引いたものは、最近使ったものになる。
   * @param key 鍵
   * @returns 値。なければ undefined
   */
  get(key: Key): Value | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  /**
   * 値を入れる。上限を超えたら、いちばん長く使っていないものを消す。
   * @param key 鍵
   * @param value 値
   */
  set(key: Key, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  /** 残している数 */
  get size(): number {
    return this.entries.size;
  }
}
