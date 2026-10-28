# 地圖資料轉換器（可刪）

兩個工具，解決兩種情境：

| 工具 | 情境 | 輸入 |
| --- | --- | --- |
| `geo2svg.html` | 有**結構化地理資料** | GeoJSON、OSM XML、Shapefile(zip)、Overpass 直連 |
| `trace2svg.html` | 只有**一張圖**（截圖、掃描） | PNG / JPG / WEBP，自動描邊成向量 |

兩者輸出都是 1200×840（10:7）SVG，都能「下載」或「一鍵設為底圖」。

## geo2svg.html

| 格式 | 說明 |
| --- | --- |
| `.geojson` / `.json` | FeatureCollection、Feature、Polygon、MultiPolygon、LineString |
| `.osm` / `.xml` | OpenStreetMap XML，優先取 `natural=coastline`，自動串成閉合環 |
| `.shp` / `.zip` | ESRI Shapefile；Geofabrik 的 `-free.shp.zip` 可直接讀（自動解壓＋讀 DBF 區名） |
| Overpass 直連 | 頁面上兩個按鈕：香港海岸線／18 區邊界，不用找檔案 |
| `.osm.pbf` | ❌ 不支援（二進位），先 `osmium cat x.pbf -o x.osm` |

## trace2svg.html

1. 上傳一張地圖截圖（先裁成香港範圍效果最好）
2. 它會自動偵測海水色，切成水／陸二值圖
3. Marching squares 抓輪廓 → Douglas–Peucker 簡化 → 填色成向量
4. 可調：色彩容差、簡化程度、忽略小島、顏色反轉

適合：只有圖、拿不到資料的時候。缺點是**地名不會被辨識**（那是像素，不是文字）。

## 授權

- OpenStreetMap：© OpenStreetMap contributors，ODbL，公開發佈需標註
- DATA.GOV.HK：政府開放數據，可自由使用
- OpenTopoMap / Wikimedia：CC BY-SA，需署名
- Google Maps / Apple Maps 截圖：❌ 不可公開發佈

