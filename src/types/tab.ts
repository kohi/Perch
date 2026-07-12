/**
 * タブ（一時メモ）のデータモデル。requirements §5.1 準拠。
 *
 * 設計思想「賢いmiは完成品、AIは拡張スロット」に従い、AI 前提のフィールドを
 * 最初から綺麗に持つ。確定タグ(`tags`)と未確定のAI提案(`suggestedTags`)を
 * 型レベルで分離し、mozu 方式の手動確定を支える（混同を型で防ぐ）。
 */

/** 未確定のAI提案タグ（承認待ち）。confidence 閾値以上は自動確定、未満は提案止まり。 */
export interface SuggestedTag {
  name: string;
  /** 0〜1。閾値（既定0.8）以上は自動確定、未満は提案止まり。 */
  confidence: number;
}

export interface Tab {
  /** uuid */
  id: string;
  /** 本文1行目から自動生成（編集可） */
  title: string;
  /** Markdown 本文 */
  body: string;
  /** ピン留め */
  pinned: boolean;
  /** epoch ms */
  createdAt: number;
  /** epoch ms（1文字ごとに更新） */
  updatedAt: number;
  /** 確定タグ（自動確定＋手動で確定したもの）。YAML に書き出されるのはこれだけ。 */
  tags: string[];
  /** 未確定のAI提案タグ（承認待ち）。Vault には書き出さない。 */
  suggestedTags?: SuggestedTag[];
  /** Vault 昇格済みか */
  promoted: boolean;
  /** 昇格先の .md パス */
  promotedPath?: string;
}

/**
 * 新規タブ作成時の初期値を生成する純関数。
 * id/時刻は呼び出し側から注入し、テスト容易性（決定性）を確保する。
 */
export function createTab(params: {
  id: string;
  now: number;
  body?: string;
  title?: string;
}): Tab {
  const body = params.body ?? "";
  return {
    id: params.id,
    title: params.title ?? "",
    body,
    pinned: false,
    createdAt: params.now,
    updatedAt: params.now,
    tags: [],
    suggestedTags: [],
    promoted: false,
  };
}
