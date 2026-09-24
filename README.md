# 島嶼天氣誌｜臺灣智慧氣象與預報驗證

一個以臺灣氣象資料為核心的課程 MVP。React + Leaflet 顯示測站觀測、鄉鎮預報、網站警特報、地震與颱風；Flask 從中央氣象署取得資料，解析後保存於本機 SQLite 或線上的 Turso。預報驗證只比較溫度，並保留每次取得的預報版本。

## Demo

**線上展示：[島嶼天氣誌｜https://aiot-hw1.vercel.app/](https://aiot-hw1.vercel.app/)**

[![島嶼天氣誌正式站截圖：測站氣溫地圖、資料概況、行政區選擇與天氣特報](docs/images/weather-dashboard.png)](https://aiot-hw1.vercel.app/)

截圖日期：2026-09-24。點擊圖片即可開啟正式站；實際氣象資料與更新時間以網站顯示為準。

## 功能與特色

- 22 縣市、368 鄉鎮市區的三天預報；可查看溫度、體感溫度、濕度、降雨機率與天氣現象。
- 10 分鐘測站觀測地圖：氣溫、雨量、濕度、風速風向、天氣現象。縮小地圖時每縣市顯示代表觀測點，放大後顯示全部測站。
- 雷達透明影像、颱風路徑、最近顯著有感地震、縣市界與深色／街道底圖。
- 從中央氣象署公開網站擷取警特報清單；來源未同步時明確顯示未知狀態。
- 將鄉鎮預報與明確指定的代表測站配對，計算絕對誤差和 MAE。畫面顯示資料時間與缺值。
- 免輸入密鑰、具共用冷卻限制的手動同步，以及 Vercel Hobby 每日排程範例。

此專案版面與視覺語言為自行設計。縣市界圖資取自 [g0v/twgeojson](https://github.com/g0v/twgeojson)，地圖使用 Leaflet；底圖分別來自 Esri 與 OpenStreetMap，須保留圖上來源標示。

## 技術與資料流

| 層次 | 技術 | 工作 |
| --- | --- | --- |
| 前端 | React、Vite、Leaflet | 地圖、圖層、鄉鎮選擇、預報驗證 |
| 後端 | Python、Flask | CWA API、網站擷取、解析、REST API |
| 資料庫 | SQLite（本機）、Turso（Vercel） | 保存測站、觀測、預報版本、警特報、地震、颱風 |

`中央氣象署 API／公開網站 → Flask → 解析與驗證 → SQLite/Turso → Flask REST API → React`

React 不呼叫需要授權碼的 CWA API，授權碼只存在伺服器環境變數。雷達時間清單先存入資料庫，歷史 PNG 由 Flask 快取轉送；NOAA GFS 風場先解析成規則格點存入資料庫。地圖底圖使用外部圖磚。

## 資料來源與時間粒度

| 用途 | 來源 | 使用方式 |
| --- | --- | --- |
| 地圖觀測 | `O-A0003-001` | CWA 開放資料 API，約 10 分鐘觀測 |
| 誤差分析觀測 | `O-A0001-001` | CWA 開放資料 API，逐時觀測 |
| 鄉鎮預報 | `F-D0047-001, 005, …, 085` | 22 個縣市資料集；近時段逐時，後續逐三小時 |
| 地震 | `E-A0015-001` | 顯著有感地震 |
| 颱風 | `W-C0034-005` | 活動熱帶氣旋分析與預報路徑 |
| 雷達 | 官方 `Observe_radar.js` / `CV1_3600` | [官方雷達頁](https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html)，最近 13 個已發布影像，範圍 115–126.5°E、17.75–29.25°N |
| 海上風場 | NOAA GFS `ncep_global` | [官方 ERDDAP](https://upwell.pfeg.noaa.gov/erddap/griddap/ncep_global.html)，0.5° 網格、10 m 高度 U/V 風速，模型目標時間每 3 小時 |
| 警特報 | [中央氣象署警特報網頁](https://www.cwa.gov.tw/V8/C/P/Warning/W26.html) | 擷取該網站載入的 `Warning_Content.js`，解析 `WarnAll` |

需求最初指定的 `F-D0047-093` [資料集頁](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-093)仍存在，但 2026-09-24 實際授權 REST 請求回傳 HTTP 404。上述 22 個縣市資料集逐一測試可用，且合計涵蓋 368 個鄉鎮市區。完整格式查核見 [docs/research/cwa-schema.md](docs/research/cwa-schema.md)，依據包括 [官方預報格式](https://opendata.cwa.gov.tw/opendatadoc/Forecast/F-D0047-001_093.pdf)及[觀測格式](https://opendata.cwa.gov.tw/opendatadoc/Observation/O-A0001-001.pdf)。

## 資料庫設計

`locations` 保存縣市、鄉鎮、地理代碼與座標；`stations` 保存測站資訊；`location_station_mapping` 保存固定代表站。保留既有中正區配對；未配對地區從同縣市、同鄉鎮且具有有效逐時氣溫的測站中，按 station_id 排序選第一站後固定保存，不跨行政區借站。目前正式資料已配對 351 個行政區。這是 MVP 可重現的行政區配對，未校正海拔及地形差異。

`observations` 使用 `(station_id, observed_at, dataset_id)` 唯一鍵去重。`forecast_batches` 以來源 `records` 雜湊去除同一批重複下載，並保存 `issued_at` 與 `fetched_at`。`forecasts` 以 `(batch_id, location_id, kind, start_at, end_at)` 唯一鍵避免同版重複，但不同版本不覆蓋。`earthquakes`、`typhoon_points`、`warnings` 及 `source_status` 保存延伸圖層與同步狀態。資料庫主要欄位是正規化值，不是整包原始 JSON。

預報 REST 回傳沒有可信的發布時間，因此 `issued_at` 目前使用**取得時間代理**。相同內容重抓不產生新版本；來源內容有變化才建立新批次。這代表「取得時間」不是氣象署真正的發布時間。

## 預報與觀測的配對方法

1. 只用 `DataTime` 的單點溫度預報；`StartTime`／`EndTime` 的 12 小時平均溫度不能和某小時觀測直接比較。
2. 由 `location_station_mapping` 找行政區代表測站，不自動用遠處測站填空。
3. 對每個預報目標時間，選取 **目標時間之前取得的最後一版預報**；歷史版本仍留在資料庫。
4. 在該測站的 `O-A0001-001` 逐時觀測中，取最接近目標時間且時間差 **不超過 ±30 分鐘**、溫度有效的一筆；等距時取較早觀測。
5. `Absolute Error = |預報溫度 − 實測溫度|`；有效配對至少兩筆後，`MAE = 絕對誤差總和 ÷ 配對筆數`。

剛開始同步時，預報的目標時間還在未來，尚無可比較的實測；畫面會顯示「等待觀測」，不能以示範數字冒充真實 MAE。每日一次同步也只保存當次可取得的逐時觀測，因此 MAE 樣本累積較慢。

## 快速開始：本機 SQLite

需要 Python 3.10 以上、Node.js 與 npm。SQLite 隨 Python 內建，**不需要另行架設 PostgreSQL**。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

到[中央氣象署氣象資料開放平台](https://opendata.cwa.gov.tw/)註冊並在帳戶頁取得 Authorization Key，填入 `.env` 的 `CWA_API_KEY`。排程使用另行產生的 `CRON_SECRET`；訪客更新不需輸入任何金鑰。`.env` 已被 `.gitignore` 排除。

初次取得資料並建立 SQLite 表格：

```bash
set -a; source .env; set +a
PYTHONPATH=backend python -m weather.sync --all
```

只更新臺北市預報的範例：

```bash
PYTHONPATH=backend python -m weather.sync --dataset F-D0047-061
```

後端：

```bash
python -m flask --app app run --port 5000
```

另一個終端啟動前端：

```bash
cd frontend
npm ci
npm run dev
```

開啟 `http://localhost:5173`。Vite 開發伺服器會把 `/api` 轉送到本機 Flask。前端正式建置可執行 `cd frontend && npm run build`。

## 環境變數

| 名稱 | 用途 |
| --- | --- |
| `CWA_API_KEY` | 伺服器呼叫中央氣象署 API 的 Authorization Key，必要 |
| `CRON_SECRET` | Vercel 排程 GET 同步所用的 Bearer 密鑰；Vercel 會自動附帶 |
| `SQLITE_PATH` | 本機 SQLite 檔案路徑；預設 `backend/weather.sqlite3` |
| `TURSO_DATABASE_URL` | 線上 Turso 資料庫 URL；Vercel 環境必要 |
| `TURSO_AUTH_TOKEN` | 線上 Turso 認證令牌；Vercel 環境必要 |

`GET /api/refresh` 排程需正確的 `Authorization: Bearer <CRON_SECRET>`。`POST /api/refresh` 開放手動更新，但每個白名單來源以資料庫原子租約限制五分鐘一次（失敗也計入），所有訪客共用。重複請求回傳 `cached: true` 與冷卻提示，不重新抓取上游。雷達圖片另有跨 worker 快取、單圖租約與失敗重試限制。CWA 金鑰仍只放伺服器端。

## REST API

| 方法與路徑 | 回傳 |
| --- | --- |
| `GET /api/health` | 服務健康狀態 |
| `GET /api/stations` | 10 分鐘觀測測站；可加 `?dataset=O-A0001-001` |
| `GET /api/locations` | 行政區與代表站 |
| `GET /api/forecast?location_id=…` | 最新批次的未來預報 |
| `GET /api/analysis?location_id=…` | 有效配對、絕對誤差、樣本數、MAE |
| `GET /api/warnings` | 網站擷取的特報清單與來源狀態 |
| `GET /api/earthquakes` | 最近地震 |
| `GET /api/typhoons` | 颱風分析／預報路徑點 |
| `POST /api/refresh?dataset=…` | 免輸入密鑰、具共用冷卻限制的手動同步 |

## Vercel 與 Turso

Vercel 函式的本機 SQLite 檔案不具持久性，因此正式環境必須設定 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`；程式在 `VERCEL` 環境沒有 Turso URL 時會拒絕使用臨時 SQLite。[Vercel Flask 文件](https://vercel.com/docs/frameworks/backend/flask)說明 Flask `app.py` 入口與 `public/` 靜態檔案；[Vercel SQLite 說明](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)說明其持久化限制。

1. 建立 Turso 資料庫及認證令牌，將上述兩個值加到 Vercel 專案 Production 私密環境變數。另設定 `CWA_API_KEY`、`CRON_SECRET`。
2. 以 `vercel --prod` 部署。根目錄的 `vercel.json` 會建置 React 並放入 `public/`；`api/index.py` 將 `/api/*` 交給 Flask。`app.py` 是本機 Flask 入口。
3. 第一次上線後點選「更新資料」同步，或在連接 Turso 的本機環境執行上述 `weather.sync --all` 初始化全臺。
4. Vercel Hobby 的 Cron 每項工作每天最多執行一次；本專案範例每日更新觀測、22 縣市預報、地震、颱風與特報，預報工作分散於不同小時。實際時間以網站顯示的觀測時間為準，不能把每日同步說成每 10 分鐘即時更新。[Vercel Cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)。

**正式站：**[aiot-hw1.vercel.app](https://aiot-hw1.vercel.app/)；程式碼：[superMLK/AIoT-HW1](https://github.com/superMLK/AIoT-HW1)。2026-09-24 已使用 Turso 初始化 368 個行政區的資料，並驗證正式站首頁、測站、鄉鎮預報、警特報、地震、颱風及分析 API。程式碼已推送 GitHub，但 Vercel 帳戶尚未建立 GitHub Login Connection，**推送不會自動觸發部署**；目前由維護者執行 `vercel --prod` 上版。

## 測試與目前限制

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
cd frontend && npm run build
```

- 警特報爬蟲目前從官方網站載入的 JS 取得「有哪些特報」，尚未解析警報內文、影響地區與結束時間；不能把它當完整 CAP 警報。
- 雷達從官方索引取得真實時間，去除影像灰階底圖並依緯度逐列轉為 Web Mercator。原圖標示覆蓋的區域無法還原回波；這是教學視覺化，不能作精密定位或降雨量推估。
- 縣市界使用 g0v 2010 年圖資並經簡化，適合示意，不適合精確行政界查詢。
- 地圖小比例尺只顯示各縣市一個觀測點，不代表縣市平均值；放大後才顯示全部站點。
- 無同區有效逐時測站時不分析。即使已配對，也需要事前預報及同期觀測；Hobby 每日同步會漏掉多數逐時觀測。MAE 至少兩筆，缺資料不補零、不虛構。
- 一日一次排程無法提供高頻歷史觀測；若需要更密集的 MAE 樣本，須調整同步策略或方案。

後續可補警報影響地區、人工審核代表站地形適宜性，以及更密集且受控的資料同步；不把機器學習、帳號系統或推播納入本版。

## 地圖操作與資料解讀

- 地圖佔滿觀測頁，左側摘要／特報及右側圖層浮在地圖上，可用「隱藏面板」收起。「附近測站」會定位並放大到最近站。
- 行政區選擇放在預報頁，不自動跳頁；未來預報列表包含完整欄名，天氣圖示保留可讀取的文字替代說明。
- 雨量為當日累積量，以測站 20 km 內距離加權插值；透明不代表無雨，也不是雷達降水。濕度用色點，灰色表示缺值。
- 風場是 NOAA GFS 模型 U/V 格點的雙線性插值，流線速度經視覺化縮放；箭頭為氣象署測站實測，可關閉。模型目標時間與觀測時間分開顯示，並非同一資料。
- 颱風以實線顯示分析軌跡、虛線顯示預報。黃色包絡連接官方各目標時間的 70% 機率半徑；它不是官方原圖。實圈使用來源提供的平均 15／25 m/s 暴風半徑，不宣稱重現不對稱象限半徑。
- 雷達與颱風可播放或手動拖曳時間軸。按更新才重新擷取資料；Hobby 排程每天一次，圖層不是持續即時串流。

`GET /api/radar`、`GET /api/wind` 查詢已保存的雷達時間清單與風場。`POST /api/refresh?dataset=radar`／`wind` 更新相應來源。

本機舊資料可透過 `PYTHONPATH=backend python backend/scripts/import_history.py` 補入已設定的 Turso；工具保留原始取得時間，僅用於匯入本專案真實已保存的歷史，不用來製造分析樣本。
