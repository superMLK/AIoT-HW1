# Vercel 部署與持久化資料庫

第一版使用 React、Flask，並部署至 Vercel；本機使用 SQLite，線上使用 Turso。Vercel Function 的本機檔案無法作為可靠的持久化儲存，而預報版本與觀測歷史必須跨請求與部署保留，因此正式環境使用相容 SQLite 的雲端資料庫。

參考：[Vercel SQLite 限制](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)、[Vercel Flask 文件](https://vercel.com/docs/frameworks/backend/flask)。
