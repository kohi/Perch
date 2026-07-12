# GIT-WORKFLOW.md — マルチエージェント開発における Git 運用憲法

> このファイルは **プロジェクト非依存の汎用ルール**。
> Adjuvox / Helm / kokage / kotohogi / STRENGLOW など、Claude Code マルチエージェント開発を行う
> すべてのプロジェクトのルートに配置して使う。
>
> 各プロジェクトの `CLAUDE.md` および各 Wave 起動プロンプトは「Git 運用は GIT-WORKFLOW.md に従う」と
> 参照するだけでよい。Git ルールを個別にベタ書きしないこと。

---

## 0. なぜこのファイルがあるか

マルチエージェント開発（Wave 方式、サブエージェント並列、worktree 利用）では、
**「実装は完了したが Git 状態が正しくない」** 事故が起きやすい。典型例:

- 各エージェントが worktree / ブランチで作業 → main へのマージ忘れ
- 完了報告が「✅ コミット済み」と書くが、実際は別ブランチで main に乗っていない
- フォルダ rename 後に worktree のメタ参照が古いパスを指して `git status` が壊れる
- handoff ドキュメントが別ブランチのコミットに入っていて、main から見えない

これらは **実装の問題ではなく Git 運用の問題**。本ファイルはそれを構造的に防ぐ。

---

## 1. ブランチ統合の責任者

### 鉄則: 司令塔がマージする。エージェント任せにしない

- 各エンジニアエージェント / QA Guardian は、自分の worktree またはブランチでコミットする
- **Wave 完了時に main へ統合するのは司令塔（メインセッション）の責任**
- 統合は必ず `git merge --ff-only` を使う
  - fast-forward できない = 想定外の分岐がある = 異常。`--ff-only` が失敗したら**作業を止めて人間に報告**
  - 勝手に `git merge`（非 ff）や `git rebase` で解決しようとしない

```bash
# Wave 完了時の標準統合手順（司令塔が実行）
git checkout main
git merge --ff-only <wave-branch>     # ff できなければ停止して報告
git log --oneline -5                  # HEAD が想定コミットになっているか確認
```

### 並列エージェントの場合

複数エージェントが並列で別 worktree / ブランチで作業した場合:
- 各ブランチは**ファイル所有権が完全分離**している前提（重複していたら設計ミス）
- 司令塔が順に `--ff-only` で統合する。分離されていれば順次 ff 可能
- ff できないブランチが出たら、ファイル所有権の設計が破られている。停止して報告

---

## 2. worktree のライフサイクル

worktree を使う場合、**作る → 使う → Wave 完了時に必ず掃除** のサイクルを徹底する。

### 作成

```bash
git worktree add <path> -b <branch-name>
```

### 掃除（Wave 完了時、main 統合後に必ず実行）

```bash
git worktree remove <path>            # worktree を外す
git worktree prune                    # 無効な参照を掃除
git branch -d <branch-name>           # マージ済みブランチを削除
git worktree list                     # 本体のみになっていることを確認
```

### 絶対ルール

- **Wave 完了時に worktree を残さない**。次の Wave に持ち越さない
- `.gitignore` に worktree のチェックアウト先（例: `.claude/worktrees/`）を**最初から**含める
  - 既にコミットされてしまっている場合は `git rm -r --cached <path>` で index から外す
- フォルダを rename / 移動する場合、**事前にすべての worktree を削除**してから行う
  - rename 後に worktree のメタ参照（`.git/worktrees/*/gitdir`）が古いパスを指して壊れるため

### 一括掃除枠（ブランチ / タグ削除の繰延）

上記の即時掃除のうち、**マージ済みブランチの削除（local / origin）と一時タグの削除**に限り、
「本番安定後の一括掃除枠」として繰り延べてよい。

- **worktree の削除・prune は繰延不可。** Wave 完了時に必ず実施する（残骸は `git status` を壊すため）
- 繰延できるのは **main に統合済み**（`git branch --merged` で確認済み）のブランチと、
  リリース前の退避用など役目を終えた一時タグのみ。**未マージのブランチは繰延対象外**（§3 違反）
- 一括掃除の**着手タイミングは人間が判断する**（「本番が安定した」の宣言後）。エージェントが自律的に始めない
- 一括掃除の標準手順:

```bash
git branch --merged main               # 統合済みであることを1本ずつ確認
git branch -d <branch>                 # local 削除（-D は使わない）
git push origin --delete <branch>      # origin 削除
git tag -d <tag> && git push origin --delete <tag>   # 一時タグの削除
git branch -a                          # 掃除後の残存確認
```

### worktree 残骸が出てしまったときの復旧

`git status` が `fatal: not a git repository: .../worktrees/...` を出す場合:

```bash
# 1. 診断
git worktree list
ls -la .git/worktrees/
cat .git/worktrees/*/gitdir            # 各 worktree が指すパスを確認

# 2. 壊れた worktree のチェックアウトディレクトリを直接削除
rm -rf <壊れた worktree のパス>

# 3. メタ参照を掃除
git worktree prune -v

# 4. 確認
git status                             # fatal が消えたこと
```

---

## 3. Wave 完了条件に Git 状態を含める

各 Wave の Definition of Done に、実装・テストだけでなく **Git 状態の健全性**を必ず含める。

### Wave 完了条件（Git 部分）

- [ ] 担当ブランチ / worktree のコミットがすべて main に統合されている
- [ ] `git status` が clean（untracked の作業メモ等を除き、変更が残っていない）
- [ ] `git log --oneline -N` の HEAD が、その Wave で作成した最後のコミットになっている
- [ ] `git worktree list` が本体リポジトリのみ（不要な worktree が残っていない）
- [ ] 未マージのローカルブランチが残っていない（`git branch` で確認）
- [ ] main がリモートに push されている（`git status` が `up to date` または push 済み）

---

## 4. 完了報告の必須項目

### 「✅」だけの報告は無効とする

Wave 完了報告・タスク完了報告には、以下の **実際のコマンド出力**を必ず含める。
チェックマークや要約だけの報告は受け付けない（報告と実態の乖離を防ぐため）。

### 必須の実出力

```
git log --oneline -5        # 直近コミット。HEAD の位置を示す
git status                  # clean かどうか
git worktree list           # worktree が本体のみか
```

### handoff ドキュメントの扱い

- 「handoff を作成した」と報告する場合、**ファイルの絶対パスまたはリポジトリ相対パスを明記**する
- 可能なら `ls docs/handoff/` 等の実出力を添える
- handoff は実装と同じコミットに含める（別ブランチ・別コミットに散らさない）

---

## 5. QA Guardian の Git 検証責任

QA Guardian は、テストの green 判定だけでなく、**Git 状態の検証**も完了宣言の前提条件とする。

### QA Guardian が完了宣言前に必ず確認すること

- [ ] このWaveの全エンジニアのコミットが、検証対象のブランチ（または main）に乗っているか
  - `git log --oneline` で各エンジニアのコミットが連なっていることを確認
- [ ] 未統合のブランチ / 宙ぶらりんのコミットが無いか
  - `git log --oneline --all --graph` で分岐していないか確認
- [ ] worktree 残骸が無いか（`git worktree list`）
- [ ] テストが green なのは「main に統合される予定の状態」であることを確認
  - 別ブランチで green でも、それが main に乗らなければ意味がない

### QA Guardian がしてはいけないこと

- テストだけ見て「完了」と報告し、Git 統合状態を確認しない
- 「コミット済み」という他エージェントの自己申告を、`git log` で裏取りせずに信じる

---

## 6. push のタイミング

- **各 Wave の QA 完了 + main 統合後**、司令塔が `git push origin main` を実行する
- push は Wave 単位。Wave 途中の中間コミットを都度 push する必要はない
- push 後、`git status` が `Your branch is up to date with 'origin/main'` になることを確認
- push もまた完了報告の必須確認項目（§4）に含まれる

---

## 7. コミット規約

### 1 コミット 1 論理単位

- 複数の論理変更を 1 コミットに混ぜない
- `git add -A` を使うときは、**意図しないファイルが巻き込まれていないか** `git status` でステージ内容を必ず確認してからコミット
  - 特に起動プロンプト・作業メモ・worktree チェックアウトの巻き込みに注意

### コミットメッセージの形式

```
<type>(<scope>): <要約>

例:
feat(w2a-tts): web speech api preview implementation
test(w2-qa): e2e and integration for phase 2
fix(w4-pre): formatted chapters in pipeline
docs(p2-w1.5): backfill missing handoff documents
chore: remove stale worktree entries from git index
```

- type: `feat` / `fix` / `test` / `docs` / `chore` / `refactor`
- scope: Wave 識別子（`w2a` `p2-w1` 等）またはサブシステム名

---

## 8. フォルダ rename / 移動時の手順

プロジェクトフォルダを rename・移動する場合（例: 日本語パス回避のための rename）、
**以下の順序を厳守**する。順序を誤ると worktree 参照が壊れる。

```bash
# 1. すべての worktree を削除（rename 前に必ず）
git worktree list
git worktree remove <各 worktree>
git worktree prune

# 2. 未コミットの変更が無いことを確認
git status                             # clean であること

# 3. ここで初めてフォルダを rename / 移動
mv <旧パス> <新パス>

# 4. 新パスで Git が正常動作することを確認
cd <新パス>
git status
git log --oneline -3
git worktree list                      # 本体のみ

# 5. Claude Code を新パスで起動し直す
```

rename 後に worktree 残骸が出てしまった場合は §2 の「復旧」手順を使う。

---

## 9. トラブルシューティング早見表

| 症状 | 原因 | 対処 |
|---|---|---|
| 完了報告は「✅」だが `git log` の HEAD が古い | コミットが別ブランチ / worktree に取り残されている | `git log --all --graph` で迷子コミットを特定 → `git merge --ff-only` で main に統合 |
| `git merge --ff-only` が失敗する | 想定外の分岐がある（ファイル所有権の設計違反など）| 停止して人間に報告。安易に非 ff マージ / rebase しない |
| `fatal: not a git repository: .../worktrees/...` | フォルダ rename で worktree メタ参照が古いパスを指している | §2「復旧」手順。壊れた worktree ディレクトリを直接 `rm -rf` → `git worktree prune` |
| `git status` に身に覚えのない `deleted:` 表示 | `.gitignore` 追加前にコミットされたファイルがある | `git rm -r --cached <path>` で index から外してコミット |
| `cannot delete branch ... used by worktree` | ブランチを worktree が掴んでいる | 先に `git worktree remove` → その後 `git branch -d` |
| handoff が `find` で見つからない | handoff が未マージのブランチのコミットに入っている | まず main へのマージを完了させてから探す。それでも無ければ実コードから再生成 |

---

## 10. ドキュメント版上げ・保全

要件定義書・設計書・監査記録などの **ドキュメントを版上げ・改変する場合**、
実装コードと同じく「記憶は仮説、grep が事実」を適用する。
**参照グラフと履歴を実測してから触る。** 決め打ちで rename / 上書きしない。

### 10.1 版上げ時の rename 可否判定（参照グラフを測ってから決める）

要件定義書などを新版に上げるとき、旧版ファイルを **rename して使い回すか / 新版を新規作成するか** は、
**旧版がどれだけ参照されているかを grep で測ってから**決める。いきなり rename しない。

```bash
# 1. 旧版ファイル名がリポジトリ内で何箇所から参照されているか測る
grep -rl "<旧版ファイル名>" .        # 参照しているファイルの一覧
grep -rc "<旧版ファイル名>" . | grep -v ':0'   # 箇所数の把握
```

判定基準:

| 参照数 | 対応 |
|---|---|
| 少数（数箇所） | 旧版を `git mv` で rename し、参照側も同コミットで追従修正してよい |
| **多数（Helm では 25+ ファイル）** | **rename 禁止。新版を新規作成し、旧版はその場に凍結する** |

多数参照のケースで新版を作る場合の手順:

- 新版（例: `..._v(N+1).md`）を **新規作成**する（旧版は消さない・動かさない）
- 旧版（例: `..._vN.md`）の冒頭に **凍結ポインタ**を1ブロック追記する。以降、旧版は編集しない

```markdown
> ⚠️ このドキュメントは vN で凍結。最新は <新版ファイル名> を参照。
> vN は多数ファイルから参照されているため rename せず、この場に凍結ポインタとして残す。
```

理由: 多数の参照リンクを一括 rename すると、参照側の追従漏れ・履歴の分断・レビュー不能な巨大差分を招く。
**参照は生かしたまま、正本ポインタだけ新版へ向ける**のが安全。

### 10.2 監査・履歴記録の保全（遡及改変しない）

以下の系統のドキュメントは **記録の正しさそのものが価値**なので、後から内容を書き換えない。
更新が必要なら **追記の注記**で行い、元の記述は残す（falsification 回避）。

- スコープ測定・監査記録（例: `docs/scope-*/measurement-*.md`）
- エージェントの帰属記録・実行計画（例: `.claude/agents/*.md` 内の実行ログ・意思決定記録）
- 完了報告・Wave 記録など、後から「当時こうだった」を証明する必要があるもの

やってよいこと / いけないこと:

- ⭕ 当時のスナップショットである旨を **追記注記**する（例: 「これは Wave26 前のスナップショット」）
- ⭕ モデル名など運用値の陳腐化は、**tier / 意味を保存したまま**現行値へ更新する（帰属記録・実行計画本文は保全）
- ❌ 測定結果・意思決定記録の本文を、後の状態に合わせて**遡及的に書き換える**こと
- ❌ 「今と違うから」という理由だけで過去の記録を削除すること

原則: **監査記録は追記で育て、遡及改変しない。** 記録が現状と食い違って見えても、
それは「当時の事実」であり、書き換えるのではなく注記で橋渡しする。

---

## 11. このファイルの保守

- `GIT-WORKFLOW.md` は全プロジェクト共通の正本。改善はこのファイルに対して行う
- 改善したら、運用中の全プロジェクトに同じ内容をコピーして横展開する
- プロジェクト固有の事情（特定のブランチ命名規則など）は各プロジェクトの `CLAUDE.md` 側に書き、
  本ファイルには汎用ルールのみを保つ

---

以上、GIT-WORKFLOW.md。マルチエージェント開発における Git 運用憲法。
