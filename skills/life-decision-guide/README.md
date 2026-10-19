# 人生決策 skill（life-decision-guide）

讓 AI 助手照《高性價比人生指南》回答具體問題：該不該做、值不值、怎麼選、出事了先做什麼、能領哪筆錢、這麼幹犯不犯法。

它做的事只有一件：**先把相關條目從正文裡查出來，再照書的算賬方式排序回答**，每條註明出自第幾節第幾條。查不到就說查不到，不憑記憶編數字。

規則全在 [SKILL.md](SKILL.md) 裡，兩個工具共用同一個文件，不維護兩份。

## 裝到 Claude Code

在本倉庫裡開 Claude Code，不用裝——`.claude/skills/life-decision-guide/` 已經指向這份規則。

想在任何目錄下都能用，複製到個人 skill 目錄：

```bash
mkdir -p ~/.claude/skills/life-decision-guide && curl -fsSL -o ~/.claude/skills/life-decision-guide/SKILL.md "https://raw.githubusercontent.com/eternity4719/HowToLiveBetter/main/skills/life-decision-guide/SKILL.md"
```

之後直接問「每天通勤兩小時值不值」「朋友讓我替他擔保，籤不籤」就會觸發；也可以顯式說「用 life-decision-guide 回答」。

## 裝到 Codex

在本倉庫裡開 Codex，不用裝——根目錄的 `AGENTS.md` 已經把它指出來了。

想在任何目錄下都能用，複製到 Codex 的個人 skill 目錄 `~/.agents/skills`：

```bash
mkdir -p ~/.agents/skills/life-decision-guide && curl -fsSL -o ~/.agents/skills/life-decision-guide/SKILL.md "https://raw.githubusercontent.com/eternity4719/HowToLiveBetter/main/skills/life-decision-guide/SKILL.md"
```

之後直接問問題就會按描述自動觸發，也可以輸入 `$life-decision-guide` 顯式調用。注意是 `$` 不是 `/`，新版 Codex 輸入 `/life-decision-guide` 會報 `Unrecognized command`。沒出現就重啟一次 Codex。

舊版 Codex 還沒有 skill，只能用自定義提示詞：把文件放到 `~/.codex/prompts/life-decision-guide.md`，再用 `/life-decision-guide` 調用。Codex 已宣佈棄用這套寫法（[openai/codex#10848](https://github.com/openai/codex/issues/10848)），新版用上面的 skill 裝法。

## 正文從哪來

本地有這個倉庫就讀本地的 `book/`；没有就现取：

```bash
git clone --depth 1 https://github.com/eternity4719/HowToLiveBetter.git "${TMPDIR:-/tmp}/hltb"
```

整本 1.3 MB，淺克隆一次幾秒。取不到網絡就如實說取不到，不替代正文。

## 改動須知

SKILL.md 裡不留任何會跟著正文漂的清單和數值：節的清單去讀 README 的「這本書想回答的問題」表，性價比檔的算法去讀 `index.html` 裡的 `COST_W` 和 `e.ratio` 兩行。所以增刪節、改檔位規則都不用動這個目錄。
