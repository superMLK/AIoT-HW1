# 中央氣象署資料格式核對（2026-09-24）

## 鄉鎮預報 F-D0047-093

[資料集](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-093)現存，更新約每 6 小時。[官方格式文件](https://opendata.cwa.gov.tw/opendatadoc/Forecast/F-D0047-001_093.pdf)指出：未來 1 天有逐時氣溫等資料、未來 3 天逐 3 小時資料、未來 7 天逐 12 小時及逐日區間資料。預報代表點為鄉鎮公所。2024-12-10 的[官方格式異動公告](https://opendata.cwa.gov.tw/announcement/news/280?page=7)改用了 `LocationName`、`ElementName`、`DataTime` 等參數名稱。

官方公告提供的 [JSON 範例 ZIP](https://opendata.cwa.gov.tw/opendatadoc/standard/news_20241128.zip) 內有 F-D0047-001（3 天）與 F-D0047-003（逐 12 小時）樣本。實際結構為 `records.Locations[].Location[].WeatherElement[].Time[]`。溫度、體感溫度與濕度的逐時／逐 3 小時資料使用 `DataTime`；天氣現象與降雨機率用 `StartTime`、`EndTime`。逐 12 小時平均溫度也用開始／結束時間，不能當成單一時點觀測比較。ZIP 沒有 F-D0047-093 的整包樣本，正式同步仍須以真實授權 API 回傳再驗證。

2026-09-24 使用有效授權碼實測：`/api/v1/rest/datastore/F-D0047-093?format=JSON` 回傳 HTTP 404；加 `locationId=F-D0047-061` 仍回傳 404。改用官方仍可讀取的 22 個各縣市三天鄉鎮預報資料集 `F-D0047-001, 005, …, 085`；逐一驗證皆 HTTP 200，總計 368 鄉鎮市區。`F-D0047-089` 雖可讀取，但只有 22 個縣市層級預報，不符合鄉鎮需求。實際 `F-D0047-061` 回傳臺北市 12 區，每區 `溫度` 有 56 個 `DataTime`，`風速`／`風向` 有 32 個 `DataTime`，`3小時降雨機率` 用 `StartTime`／`EndTime`。

各縣市 REST 回傳的 `records` 沒有可信的發布時間，因此以取得時間作 `issued_at` 代理值，並用 `records` 內容雜湊判斷同一版，避免每次手動更新都插入重複預報。

## 觀測 O-A0001-001 與 O-A0003-001

[官方欄位標準](https://opendata.cwa.gov.tw/opendatadoc/Observation/O-A0001-001.pdf)列出 `Station/StationId`、`Station/ObsTime/DateTime`、`Station/GeoInfo/Coordinates`、`Station/WeatherElement/AirTemperature` 等路徑。座標同時可能有 TWD67 與 WGS84，地圖須選 WGS84。`AirTemperature`、`WindSpeed`、`RelativeHumidity` 的 `X`、`-99` 是無效值；降水的 `T` 代表雨跡、`-98`／`-99` 是特殊狀態；風向 `990` 代表不定，均不得當一般數值。O-A0001-001 為逐時，O-A0003-001 為 10 分鐘觀測。

## 天氣特報網站

[中央氣象署特報頁面](https://www.cwa.gov.tw/V8/C/P/Warning/W26.html)載入 `/Data/js/warn/Warning_Content.js`。2026-09-24 擷取到的公開 JS 包含 `WarnAll` 等變數；爬蟲應以此網頁來源判定目前有哪些特報，再連到對應頁面。當來源無法取得或格式改變，回傳「來源失敗」，不可當作「無特報」。

## 地圖延伸資料

[O-A0058-005](https://opendata.cwa.gov.tw/dataset/observation/O-A0058-005) 提供 10 分鐘雷達透明 PNG 與經緯度範圍；[W-C0034-005](https://opendata.cwa.gov.tw/opendatadoc/Warning/W-C0034-005.pdf) 提供活動熱帶氣旋過去與預報路徑；[E-A0015-001](https://opendata.cwa.gov.tw/dataset/all/E-A0015-001) 提供顯著有感地震。地震 API 於 2026 年[公告格式異動](https://opendata.cwa.gov.tw/announcement/news/316?page=1)，實作前須核對最新回傳。
