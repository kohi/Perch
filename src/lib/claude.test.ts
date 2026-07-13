import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  resolveModel,
  isAiConfigured,
  ClaudeError,
  requestMessage,
  buildTagPrompt,
  parseTagResponse,
  buildRankPrompt,
  parseRankResponse,
  suggestTags,
  rankNotes,
} from "./claude";

/**
 * claude.ts の実検証。純パースは canned テキストで、ネットワーク系は fetch をモックして
 * 「送信 body に model・max_tokens・ブラウザアクセスヘッダが入る」「rankNotes が候補の
 * 全文/パスを送らない（TC-607）」を assert する（偽装なし）。
 * 実接続は PERCH_LIVE_CLAUDE_KEY がある時のみ（無ければ skip をログ）。
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Anthropic Messages API 応答形（content[].text）を模したモック応答を作る。 */
function mockAnthropicResponse(text: string, ok = true, status = 200): Response {
  const payload = { content: [{ type: "text", text }] };
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** モック fetch の最初の呼び出しの [url, init] を型付きで取り出す。 */
function firstFetchCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return mock.mock.calls[0] as unknown as [string, RequestInit];
}

describe("resolveModel（設定値 > 既定）", () => {
  it("設定値があればそれを使う", () => {
    expect(resolveModel("claude-opus-9")).toBe("claude-opus-9");
  });
  it("未設定 / 空 / 空白は既定にフォールバック", () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
    expect(resolveModel("")).toBe(DEFAULT_MODEL);
    expect(resolveModel("   ")).toBe(DEFAULT_MODEL);
  });
  it("前後空白は trim する", () => {
    expect(resolveModel("  claude-x  ")).toBe("claude-x");
  });
});

describe("isAiConfigured", () => {
  it("非空キーで true、未設定/空白で false", () => {
    expect(isAiConfigured("sk-abc")).toBe(true);
    expect(isAiConfigured("")).toBe(false);
    expect(isAiConfigured("   ")).toBe(false);
    expect(isAiConfigured(null)).toBe(false);
    expect(isAiConfigured(undefined)).toBe(false);
  });
});

describe("parseTagResponse（canned・正常/壊れ）", () => {
  it("JSON 配列を name/confidence にパースする", () => {
    const r = parseTagResponse('[{"name":"税金","confidence":0.9},{"name":"確定申告","confidence":0.4}]');
    expect(r).toEqual([
      { name: "税金", confidence: 0.9 },
      { name: "確定申告", confidence: 0.4 },
    ]);
  });
  it("```json フェンス＋前置きがあっても配列を抽出する", () => {
    const r = parseTagResponse('提案です:\n```json\n[{"name":"料理","confidence":0.7}]\n```');
    expect(r).toEqual([{ name: "料理", confidence: 0.7 }]);
  });
  it("confidence は 0〜1 に clamp する", () => {
    const r = parseTagResponse('[{"name":"a","confidence":1.5},{"name":"b","confidence":-2}]');
    expect(r).toEqual([
      { name: "a", confidence: 1 },
      { name: "b", confidence: 0 },
    ]);
  });
  it("不正要素（name 欠落・confidence 非数値）は捨てる", () => {
    const r = parseTagResponse('[{"confidence":0.9},{"name":"ok","confidence":0.8},{"name":"x","confidence":"hi"}]');
    expect(r).toEqual([{ name: "ok", confidence: 0.8 }]);
  });
  it("壊れた応答は [] を返す", () => {
    expect(parseTagResponse("これはJSONではありません")).toEqual([]);
    expect(parseTagResponse("")).toEqual([]);
    expect(parseTagResponse("{ not array }")).toEqual([]);
  });
});

describe("parseRankResponse（canned・正常/壊れ）", () => {
  it("id/score にパースし score を clamp する", () => {
    const r = parseRankResponse('[{"id":"t1","score":0.95},{"id":"p/x.md","score":2}]');
    expect(r).toEqual([
      { id: "t1", score: 0.95 },
      { id: "p/x.md", score: 1 },
    ]);
  });
  it("壊れた応答は []", () => {
    expect(parseRankResponse("no json here")).toEqual([]);
    expect(parseRankResponse("[]")).toEqual([]);
  });
});

describe("buildTagPrompt / buildRankPrompt（純関数）", () => {
  it("タグプロンプトにタイトルと本文が含まれる", () => {
    const p = buildTagPrompt({ title: "確定申告メモ", body: "医療費控除について" });
    expect(p).toContain("確定申告メモ");
    expect(p).toContain("医療費控除について");
  });
  it("ランクプロンプトはクエリと候補の id/title/excerpt のみを含む", () => {
    const p = buildRankPrompt({
      query: "税金の話",
      candidates: [{ id: "t1", title: "確定申告", excerpt: "医療費…" }],
    });
    expect(p).toContain("税金の話");
    expect(p).toContain("t1");
    expect(p).toContain("確定申告");
  });
});

describe("requestMessage（fetch モック）", () => {
  it("キー未設定なら fetch せず no-key エラーを投げる", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      requestMessage({ apiKey: "", model: DEFAULT_MODEL }, { user: "hi", maxTokens: 10 }),
    ).rejects.toMatchObject({ kind: "no-key" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("送信 body に model・max_tokens、ヘッダに browser-access が入る", async () => {
    const fetchMock = vi.fn(async () => mockAnthropicResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await requestMessage(
      { apiKey: "sk-test", model: "claude-xyz" },
      { user: "質問", maxTokens: 321 },
    );
    expect(out).toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = firstFetchCall(fetchMock);
    expect(url).toContain("api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-xyz");
    expect(body.max_tokens).toBe(321);
  });

  it("HTTP エラーは api エラー、fetch 例外は network エラー", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockAnthropicResponse("boom", false, 401)));
    await expect(
      requestMessage({ apiKey: "sk", model: "m" }, { user: "x", maxTokens: 5 }),
    ).rejects.toMatchObject({ kind: "api", status: 401 });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(
      requestMessage({ apiKey: "sk", model: "m" }, { user: "x", maxTokens: 5 }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

describe("suggestTags（fetch モック）", () => {
  it("応答をパースして confidence 付きタグを返し、model/max_tokens を送る", async () => {
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse('[{"name":"税金","confidence":0.9}]'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tags = await suggestTags(
      { apiKey: "sk", model: "claude-abc" },
      { title: "確定申告", body: "本文" },
    );
    expect(tags).toEqual([{ name: "税金", confidence: 0.9 }]);
    const body = JSON.parse(firstFetchCall(fetchMock)[1].body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-abc");
    expect(typeof body.max_tokens).toBe("number");
  });
});

describe("rankNotes（fetch モック・TC-607 送信範囲最小化）", () => {
  it("候補の全文/パスを送らず id/title/excerpt のみ送る", async () => {
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse('[{"id":"t1","score":0.9},{"id":"t2","score":0.2}]'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await rankNotes(
      { apiKey: "sk", model: "m" },
      {
        query: "税金の話どっかでしたよね",
        candidates: [
          { id: "t1", title: "確定申告", excerpt: "医療費控除の抜粋" },
          { id: "t2", title: "買い物", excerpt: "牛乳を買う" },
        ],
      },
    );
    expect(results).toEqual([
      { id: "t1", score: 0.9 },
      { id: "t2", score: 0.2 },
    ]);

    // 送信 body の実体を検査：本文全文やファイルパスの断片が漏れていないこと。
    const sent = firstFetchCall(fetchMock)[1].body as string;
    expect(sent).toContain("税金の話どっかでしたよね"); // クエリは送る
    expect(sent).toContain("確定申告"); // title は送る
    expect(sent).toContain("医療費控除の抜粋"); // excerpt は送る
    // 万一 candidate に full body/path を混ぜても送らない（射影で落ちる）ことを確認
    const fetchMock2 = vi.fn(async () => mockAnthropicResponse("[]"));
    vi.stubGlobal("fetch", fetchMock2);
    await rankNotes(
      { apiKey: "sk", model: "m" },
      {
        query: "q",
        candidates: [
          // @ts-expect-error 余分フィールドを意図的に混ぜて、送信されないことを検証
          { id: "t1", title: "T", excerpt: "E", body: "SECRET_FULL_BODY", path: "/abs/secret.md" },
        ],
      },
    );
    const sent2 = firstFetchCall(fetchMock2)[1].body as string;
    expect(sent2).not.toContain("SECRET_FULL_BODY");
    expect(sent2).not.toContain("/abs/secret.md");
  });
});

describe("実接続テスト（test-spec §0・PERCH_LIVE_CLAUDE_KEY があるときのみ）", () => {
  const liveKey = process.env.PERCH_LIVE_CLAUDE_KEY;
  if (!liveKey) {
    // 黙って pass にしない：skip を明示ログして「未検証」であることを可視化する。
    console.warn(
      "[claude.test] PERCH_LIVE_CLAUDE_KEY 未設定のため実接続テストを skip します（偽装 pass ではない）",
    );
  }
  const maybe = liveKey ? it : it.skip;
  maybe(
    "実 API に接続し非空の応答を得る",
    async () => {
      const text = await requestMessage(
        { apiKey: liveKey ?? "", model: DEFAULT_MODEL },
        { user: "「ping」と一言だけ返して", maxTokens: 16 },
      );
      expect(text.trim().length).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ClaudeError の型が意図通り（呼び出し側の kind 分岐用）であることの軽い確認。
describe("ClaudeError", () => {
  it("kind と status を保持する", () => {
    const e = new ClaudeError("api", "msg", 500);
    expect(e.kind).toBe("api");
    expect(e.status).toBe(500);
    expect(e).toBeInstanceOf(Error);
  });
});
