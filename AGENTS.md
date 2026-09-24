# Project instructions

- 使用台灣繁體中文溝通與撰寫使用者文件。
- 先讀 `CONTEXT.md` 與相關 `docs/adr/`，再修改資料模型或分析規則。
- 氣象署資料解析須以官方目前實際格式及保存的來源樣本驗證；無效與缺值資料不得默默當成 0。
- React 只呼叫 Flask API；所有來源金鑰都放環境變數，並確認 `.gitignore` 不會收進 Git。
- 視覺設計須有自己的版面與配色，不複製使用者提供的參考網站。
- 每完成一個端到端階段，執行相應檢查並更新 `tickets.md`。

## Agent skills

### Issue tracker

目前使用本機 Markdown 規格與工單；接入 GitHub 遠端後仍以這些檔案作為實作依據。見 `docs/agents/issue-tracker.md`。

### Triage labels

使用 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。見 `docs/agents/triage-labels.md`。

### Domain docs

單一脈絡：根目錄 `CONTEXT.md` 與 `docs/adr/`。見 `docs/agents/domain.md`。
