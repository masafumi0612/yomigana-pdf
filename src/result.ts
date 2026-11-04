// 予想できる失敗は throw せず、戻り値で返す

/**
 * うまくいったときの値か、予想できる失敗の理由のどちらか。
 * @typeParam Value うまくいったときの値
 * @typeParam Failure 失敗の理由
 */
export type Result<Value, Failure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure };
