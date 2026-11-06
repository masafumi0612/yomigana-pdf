import { describe, expect, it } from 'vitest';

import { isPrintShortcut, type PrintShortcutEvent } from '@/viewer/print-notice';

/**
 * キーの押下の情報を作る。
 * @param key 押したキー
 * @param modifiers 一緒に押した修飾キー
 * @returns キーの押下の情報
 */
function press(key: string, modifiers: Partial<PrintShortcutEvent> = {}): PrintShortcutEvent {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe('isPrintShortcut', () => {
  it('Ctrl+P のとき、印刷の操作になる', () => {
    expect(isPrintShortcut(press('p', { ctrlKey: true }))).toBe(true);
  });

  it('Cmd+P のとき、印刷の操作になる', () => {
    expect(isPrintShortcut(press('p', { metaKey: true }))).toBe(true);
  });

  it('大文字の P のとき、印刷の操作になる', () => {
    expect(isPrintShortcut(press('P', { ctrlKey: true }))).toBe(true);
  });

  it('Ctrl+Shift+P のとき、印刷の操作にならない', () => {
    expect(isPrintShortcut(press('P', { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('Ctrl+Alt+P のとき、印刷の操作にならない', () => {
    expect(isPrintShortcut(press('p', { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('P だけのとき、印刷の操作にならない', () => {
    expect(isPrintShortcut(press('p'))).toBe(false);
  });

  it('Ctrl と Cmd を一緒に押したとき、印刷の操作にならない', () => {
    expect(isPrintShortcut(press('p', { ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it('Ctrl+O のとき、印刷の操作にならない', () => {
    expect(isPrintShortcut(press('o', { ctrlKey: true }))).toBe(false);
  });
});
