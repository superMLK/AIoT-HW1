# 圖層來源驗證（2026-09-24）

- 雷達：[官方頁面](https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html) 引用 `https://www.cwa.gov.tw/Data/js/obs_img/Observe_radar.js`，含 `CV1_3600_YYYYMMDDHHmm.png` 與台灣時間。只採索引中實際出現的最近 13 張；原影像有灰階底圖、標題、圖例，前端保留彩色回波並做等經緯度 → Web Mercator 逐列投影。標題狀態燈／圖例／Logo 區域不代表有效回波，精確定位仍應使用官方圖。
- 颱風：實際 `W-C0034-005` 的 `Fix` 提供 `MaxWindSpeed` (m/s)、`Pressure` (hPa)、`Circle15ms.Radius`、`Circle25ms.Radius`、`Radius70PercentProbability` (km)。當天資料例：舒力基分析時間 08:00，20 m/s、998 hPa、15 m/s 平均半徑 100 km。預報 +6 h 的 70% 半徑 40 km。`ForecastHour` 是相對 `InitialTime`。不將平均圓形半徑誤稱為象限不對稱半徑。
- GFS：[NOAA ERDDAP](https://upwell.pfeg.noaa.gov/erddap/griddap/ncep_global.html)，欄位 `time, latitude, longitude, ugrd10m, vgrd10m`。0.5° 網格；latitude 遞減、longitude 遞增。U 向東、V 向北，單位 m/s。查詢 10–35°N、110–145°E，共 3,621 格，取得當日 06:00 UTC 目標時間。React 向 Flask 讀取正規化資料庫格點，不直接連 NOAA。
- CWA TGFS 網頁 manifest 可取，但列出的多個 `_UV_SFC.json` 實測 404；使用者同意改接 NOAA GFS，不加入 GRIB 解析依賴。

圖層目標時間與系統擷取時間不同；播放雷達歷史不等於持續自動抓資料。雨量是測站當日累積量，距離加權插值不能視為雷達降水估計。
