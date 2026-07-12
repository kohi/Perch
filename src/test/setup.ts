// Vitest 環境で IndexedDB を提供する（jsdom には無いため）。
// fake-indexeddb はプロセス内メモリ実装。CRUD ロジックの検証に用いる。
// 注: プロセスをまたぐ実ディスク永続（強制kill復元 = TC-103）は
//     tests/e2e の Playwright 永続コンテキスト側で検証する。
import "fake-indexeddb/auto";
