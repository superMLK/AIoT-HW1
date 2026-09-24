# Issue tracker: Local Markdown

本課程專案目前沒有可用的 GitHub 遠端；`gh` 登入憑證失效。規格置於 `docs/spec.md`，實作工單置於根目錄 `tickets.md`，以檔案中的勾選狀態追蹤進度。接入 GitHub 後可繼續用同一組檔案，避免工單兩處不同步。

## Conventions

- 新需求先寫入 `docs/spec.md` 或另立 `docs/spec-<slug>.md`。
- 單一功能的工單與相依順序寫在 `tickets.md`；細節足夠讓下一位 agent 不依賴對話記憶。
- 工單狀態使用 Markdown 核取方塊；必要時可在標題下加 `Status: <role>`。
- 技能要求「publish to issue tracker」時，先更新上述檔案。若未來選擇 GitHub Issues，再更新本文件及 `AGENTS.md`。
