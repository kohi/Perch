/**
 * Claude API ラッパー（AI 隔離レイヤー）。requirements §11.4 / CLAUDE.md「Claude API」節。
 *
 * 【最重要規律】Claude API を叩くコードは **このファイル1箇所に集約** する。
 * あのあれ検索・AIタグは全てこのラッパー経由。呼び出し側にモデル名やエンドポイント、
 * ヘッダを直書きしない。モデル変更・API 仕様変更の修正点をここ1点に限定する。
 *
 * 過剰汎用化はしない（全バージョン自動対応・完全汎用パースはしない）。内部は
 * 「AI に投げる」抽象にとどめ、将来の別プロバイダ乗り換えに構造だけ備える（今は作り込まない）。
 *
 * プロンプト生成（buildXPrompt）と応答パース（parseXResponse）は **純関数** に切り出し、
 * fetch を介さず単体テスト可能にする。
 */

/**
 * 既定モデル。正は CLAUDE.md「Claude API」節（2026/07 時点 claude-sonnet-5）。
 * 変更は設定（S-07 使用モデル）で行う。新モデル対応は設定変更のみで済む構造を保つ。
 */
export const DEFAULT_MODEL = "claude-sonnet-5";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * 使用モデルを解決する。優先順位: 設定値 > 既定値（CLAUDE.md）。
 * trim して空なら既定にフォールバック。将来の環境変数上書きもこの1点で足りる構造。
 */
export function resolveModel(setting?: string | null): string {
  const s = (setting ?? "").trim();
  return s.length > 0 ? s : DEFAULT_MODEL;
}

/** API キーが設定済みか（空白のみは未設定扱い）。未設定時は呼び出し側が AI 機能をガードする。 */
export function isAiConfigured(apiKey?: string | null): boolean {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

/** ラッパーが投げるエラー種別。呼び出し側は kind でメッセージ分岐できる。 */
export type ClaudeErrorKind = "no-key" | "network" | "api";

export class ClaudeError extends Error {
  readonly kind: ClaudeErrorKind;
  readonly status?: number;
  constructor(kind: ClaudeErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ClaudeError";
    this.kind = kind;
    this.status = status;
  }
}

/** API 呼び出しの構成。model は resolveModel で解決済みの値を渡す。 */
export interface ClaudeConfig {
  apiKey: string | null | undefined;
  model: string;
}

export interface RequestArgs {
  system?: string;
  user: string;
  /** CLAUDE.md: max_tokens は必ず指定する。 */
  maxTokens: number;
}

/**
 * 低レベル: Messages API を1回叩き、`content[].text` を連結して返す。
 * キー未設定 / ネットワーク / API エラーは型付き ClaudeError を throw する。
 */
export async function requestMessage(cfg: ClaudeConfig, args: RequestArgs): Promise<string> {
  if (!isAiConfigured(cfg.apiKey)) {
    throw new ClaudeError("no-key", "Claude API キーが未設定です");
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: args.maxTokens,
    messages: [{ role: "user", content: args.user }],
  };
  if (args.system && args.system.length > 0) body.system = args.system;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": cfg.apiKey as string,
        "anthropic-version": ANTHROPIC_VERSION,
        // WebView / ブラウザから直接叩くための明示フラグ。
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ClaudeError("network", `ネットワークエラー: ${String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ClaudeError("api", `Claude API エラー (${res.status}): ${detail}`, res.status);
  }

  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const parts = Array.isArray(data.content) ? data.content : [];
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
}

// --- 純粋ヘルパ（プロンプト生成・応答パース）。fetch 非依存でテスト可能。 ---

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * 応答テキストから最初の JSON 配列（`[ ... ]`）を抽出してパースする。
 * ```json フェンスや前後の散文があっても最初の `[` 〜 最後の `]` を切り出す。
 * 壊れていれば null（＝呼び出し側は []）。過剰汎用化はせず配列のみを対象にする。
 */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface TagSuggestion {
  name: string;
  confidence: number;
}

/** AIタグ提案のプロンプト（純関数）。Claude に JSON 配列で返させる。 */
export function buildTagPrompt(input: { title: string; body: string }): string {
  return [
    "次のメモに、意味的なタグを付けてください。",
    "税金・確定申告・料理 のように短い日本語のタグ名にしてください。",
    "各タグに関連度 confidence(0〜1) を付け、JSON 配列のみを出力してください。",
    '形式: [{"name": "タグ名", "confidence": 0.0}]',
    "説明文・コードフェンス・前置きは書かないでください。",
    "",
    `タイトル: ${input.title}`,
    "本文:",
    input.body,
  ].join("\n");
}

/**
 * AIタグ応答をパースする（純関数）。name(非空文字列)と confidence(数値)を持つ要素だけ採用。
 * confidence は 0〜1 に clamp。壊れた応答は []（アプリは落とさない）。
 */
export function parseTagResponse(text: string): TagSuggestion[] {
  const arr = extractJsonArray(text);
  if (!arr) return [];
  const out: TagSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name;
    const confidence = rec.confidence;
    if (
      typeof name === "string" &&
      name.trim().length > 0 &&
      typeof confidence === "number" &&
      Number.isFinite(confidence)
    ) {
      out.push({ name: name.trim(), confidence: clamp01(confidence) });
    }
  }
  return out;
}

/** ランキングに送る候補。**id・title・短い抜粋のみ**（全文/パスは送らない = TC-607）。 */
export interface RankCandidate {
  id: string;
  title: string;
  excerpt: string;
}

export interface RankResult {
  id: string;
  score: number;
}

/**
 * あのあれ検索のランキングプロンプト（純関数）。
 * 候補は id/title/excerpt のみに射影して埋め込む（万一呼び出し側が余分なフィールドを
 * 渡しても本文やパスがプロンプトに混入しない = 送信範囲最小化の砦・TC-607）。
 */
export function buildRankPrompt(input: { query: string; candidates: RankCandidate[] }): string {
  const list = input.candidates.map((c) => ({
    id: c.id,
    title: c.title,
    excerpt: c.excerpt,
  }));
  return [
    "あなたはメモ検索アシスタントです。",
    "次の自然文クエリに意味的に近いメモを、関連度 score(0〜1) 付きで順位付けしてください。",
    "関連しないメモは含めないでください。JSON 配列のみを出力してください。",
    '形式: [{"id": "候補のid", "score": 0.0}]',
    "",
    `クエリ: ${input.query}`,
    "候補一覧(JSON):",
    JSON.stringify(list),
  ].join("\n");
}

/**
 * ランキング応答をパースする（純関数）。id(文字列)と score(数値)を持つ要素だけ採用。
 * score は 0〜1 に clamp。壊れた応答は []。
 */
export function parseRankResponse(text: string): RankResult[] {
  const arr = extractJsonArray(text);
  if (!arr) return [];
  const out: RankResult[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = rec.id;
    const score = rec.score;
    if (typeof id === "string" && typeof score === "number" && Number.isFinite(score)) {
      out.push({ id, score: clamp01(score) });
    }
  }
  return out;
}

// --- 高レベル API（requestMessage ＋ 純パース）。呼び出し側はこの2本を使う。 ---

/** AIタグ提案。confidence 付き。パース失敗時は []。max_tokens 指定必須。 */
export async function suggestTags(
  cfg: ClaudeConfig,
  input: { title: string; body: string },
): Promise<TagSuggestion[]> {
  const text = await requestMessage(cfg, { user: buildTagPrompt(input), maxTokens: 512 });
  return parseTagResponse(text);
}

/** あのあれ検索: 候補を意味順にランク付け。送信は id/title/excerpt のみ（TC-607）。 */
export async function rankNotes(
  cfg: ClaudeConfig,
  input: { query: string; candidates: RankCandidate[] },
): Promise<RankResult[]> {
  const text = await requestMessage(cfg, { user: buildRankPrompt(input), maxTokens: 1024 });
  return parseRankResponse(text);
}
