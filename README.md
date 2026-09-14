# gassakuse

Claude Code 用スキルの共有リポジトリ。

## 収録スキル

| スキル | 用途 |
|---|---|
| `short-script` | アニメ解説系 YouTube ショート / TikTok の台本を、競合動画の構造分析を踏まえて書く（60〜65秒・単一ナレーション、VOICEVOX 用 CSV 出力まで） |

スキル本体は `.claude/skills/short-script/` にある。

## 使い方

### 1. プラグインとしてインストールする（他のプロジェクトでも使いたい場合）

Claude Code 内で次を実行する。

```
/plugin marketplace add asura2479/gassakuse
/plugin install short-script@gassakuse
```

インストール後は、どのディレクトリで Claude Code を起動しても `short-script` スキルが自動で使われる。
更新を取り込むときは `/plugin marketplace update gassakuse` のあと `/plugin update short-script@gassakuse` を実行する。

### 2. リポジトリを clone して使う（このリポジトリ内で作業する場合）

```
git clone https://github.com/asura2479/gassakuse.git
cd gassakuse
claude
```

`.claude/skills/` 配下のスキルはプロジェクトスキルとして自動的に読み込まれる。

### 3. 別プロジェクトにコピーする

```
cp -r .claude/skills/short-script <別プロジェクト>/.claude/skills/
```

## スキルの呼び出し

「ショート」「台本」「フック」「競合分析」などの語を含む依頼で自動的に起動する。明示的に呼ぶ場合は `/short-script` と入力する。
