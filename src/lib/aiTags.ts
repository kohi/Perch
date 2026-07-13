/**
 * AIタグの confidence 分岐（純関数）。requirements §6.5 / screen-spec §6.1 / TC-504/505/510。
 *
 * mozu 方式ハイブリッドの核。Claude が返した confidence 付き提案を、しきい値で
 * 「自動確定（confirmed）」と「提案止まり（suggested・手動承認待ち）」に振り分ける。
 *
 * 規約:
 *  - `confidence >= threshold` は confirmed（名前のみ）。境界（=threshold）は確定側（TC-504）。
 *  - `confidence <  threshold` は suggested（name/confidence を保持し UI で承認/却下）。
 *  - しきい値変更で振り分けが変わる（TC-510）。閾値は呼び出し側が meta から注入する。
 *
 * 副作用なし・fetch 非依存でテスト可能に保つ（UI/DB とは分離）。
 */

export interface TagSuggestionInput {
  name: string;
  confidence: number;
}

export interface SplitResult {
  /** 自動確定タグ（名前のみ）。YAML にはこれ（＋ルール＋手動）だけが出る。 */
  confirmed: string[];
  /** 提案止まり（承認待ち）。Vault には書き出さない。 */
  suggested: TagSuggestionInput[];
}

/**
 * confidence でタグ提案を確定/提案に分ける。
 * `confidence >= threshold` は confirmed の名前へ、未満は suggested へ。
 * confirmed 内の重複名は除去（挿入順を保持＝決定的）。
 */
export function splitByConfidence(
  suggestions: TagSuggestionInput[],
  threshold: number,
): SplitResult {
  const confirmed: string[] = [];
  const seen = new Set<string>();
  const suggested: TagSuggestionInput[] = [];
  for (const s of suggestions) {
    const name = s.name.trim();
    if (name.length === 0) continue;
    if (s.confidence >= threshold) {
      if (!seen.has(name)) {
        seen.add(name);
        confirmed.push(name);
      }
    } else {
      suggested.push({ name, confidence: s.confidence });
    }
  }
  return { confirmed, suggested };
}
