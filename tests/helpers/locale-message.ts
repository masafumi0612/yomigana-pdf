import messages from '../../public/_locales/ja/messages.json';

/** messages.json の1つの文言 */
interface LocaleEntry {
  readonly message: string;
  readonly placeholders?: Readonly<Record<string, { readonly content: string }>>;
}

const entries: Readonly<Record<string, LocaleEntry>> = messages;

/**
 * public/_locales/ja/messages.json から文言を引く（`browser.i18n.getMessage` の代わり）。
 * @param name 文言のキー
 * @param substitution 文言の中の `$1` に入れる文字
 * @returns 文言。キーがなければ空の文字列（`browser.i18n.getMessage` と同じ）
 */
export function localeMessage(name: string, substitution?: string): string {
  const entry = entries[name];
  if (entry === undefined) return '';
  return entry.message.replace(/\$(\w+)\$/gu, (_, key: string) => {
    const content = entry.placeholders?.[key.toLowerCase()]?.content ?? '';
    return content === '$1' ? (substitution ?? '') : content;
  });
}
