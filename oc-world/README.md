# OC 世界觀站

一個可以記錄 **人物 / 人物關係圖 / 背景故事** 的靜態世界觀網站。資料全部存在一個 JSON 檔裡，頁面負責渲染。

- 瀏覽：任何地方都能開（GitHub Pages、本機、Spherse 預覽）
- 編輯：在 Spherse 裡開這個頁面 → 右上「編輯模式」
- 發佈：改完把整個 `oc-world/` 資料夾 commit & push

## 檔案

```
oc-world/
├─ index.html            頁面骨架（只有結構，沒有內容）
├─ README.md             本說明
├─ robots.txt
├─ .gitignore
├─ .nojekyll             讓 GitHub Pages 不要跑 Jekyll
├─ assets/
│  ├─ style.css          樣式（主色由資料檔的 accent 決定）
│  └─ app.js             路由、渲染、關係圖、表單、讀寫
├─ data/
│  └─ world.data.json    ★ 全部內容都在這裡
├─ media/
│  ├─ hk-map-active.svg  目前使用的地圖底圖
│  └─ README.md          上傳圖片的說明
├─ tools/                兩個轉換工具（不影響網站運作）
│  ├─ geo2svg.html       GeoJSON / OSM / SHP → SVG
│  ├─ trace2svg.html     截圖 → 自動描邊 → SVG
│  └─ README.md
└─ archive/              備份與草稿（.gitignore 已排除，不會上傳）
```

**只有前四項會影響網站**：`index.html`、`assets/`、`data/`、`media/`。`tools/` 是輔助工具，`archive/` 是備份，兩者都不影響頁面運作。

## 資料模型

```jsonc
{
  "world":      { "name", "tagline", "intro", "era", "accent", "footer" },
  "map":        { "image", "note" },
  "characters": [ { "id", "name", ... } ],
  "relations":  [ { "id", "fromId", "toId", "type", "note", "order" } ],
  "stories":    [ { "id", "title", "body", "characters", "tags", "order" } ],
  "places":     [ { "id", "name", "category", "note", "characters", "x", "y", "order" } ],
  "events":     [ { "id", "title", "date", "body", "characters", "order" } ],
  "gallery":    [ { "id", "title", "image", "caption", "characters", "order" } ]
}
```

### 頁面與資料的對應

| 頁面 | 讀什麼 | 能做什麼 |
| --- | --- | --- |
| 總覽 | `world` + 全部計數 | 編輯世界設定 |
| 人物 | `characters` / `relations` | 新增、編輯、刪除、搜尋、陣營篩選 |
| 關係圖 | `characters` / `relations` | 力導向圖，拖動節點、hover 高亮鄰近 |
| 時間綫 | `events` | 新增節點、上移下移、編輯刪除 |
| 地圖 | `map` / `places` | 上傳底圖、點空白處加標點、拖動標點 |
| 畫廊 | `gallery` | 上傳圖片、燈箱預覽、編輯刪除 |
| 故事 | `stories` | 新增、編輯、刪除 |

- `tags`／`characters` 是**逗號分隔字串**（不是陣列）；段落用空行分段。
- `type` 只能是：`親屬` `摯友` `戀人` `師徒` `同盟` `敵對` `隸屬` `其他`（顏色由頁面決定）。
- `relations` 有方向性（`fromId → toId`），但圖上不畫箭頭，避免視覺雜亂。
- `image` 存站內相對路徑（`media/x.png`）或外部網址。
- 內文支援 `**粗體**`、`*斜體*`、`> 引用`（行首）。

## 兩種編輯方式

**一、在頁面上編輯**（Spherse 內）
人物頁／關係圖／故事頁右上角都有新增按鈕，卡片上的「編輯／刪除」可修改既有資料。所有寫入都走 `$manifest` 的具名 mutation，改完即時寫回 `world.data.json`。

**二、請 AI 編輯**
AI 讀 `read_data({ file: "oc-world/data/world.data.json" })` 取得結構，再用 `query_data` / `mutate_data` 精準讀寫：
`addCharacter`、`updateCharacter`、`removeCharacter`、`addRelation`、`updateRelation`、`removeRelation`、`addStory`、`updateStory`、`removeStory`、`updateWorld`、`updateMap`、`addPlace`、`updatePlace`、`removePlace`、`addEvent`、`updateEvent`、`removeEvent`、`addGallery`、`updateGallery`、`removeGallery`。

> 地圖標點的 `x` / `y` 是 **0–100 的百分比座標**（左上為 0,0），不是像素——所以換底圖、換螢幕尺寸都不會跑位。

## 為甚麼線上版是唯讀

寫入能力來自 Spherse 注入的 `window.spherse`。GitHub Pages 只有靜態檔案，沒有後端可寫入檔案系統，所以 `app.js` 偵測不到 SDK 時會自動切成唯讀（右上角顯示「唯讀發佈版」、隱藏編輯按鈕）。

想在線上直接編輯，需要後端（例如 Cloudflare Workers + KV、Supabase）——那是另一套架構，目前刻意不做。

## 地圖底圖

目前用的是 `media/hk-map-active.svg`——由地圖截圖自動描邊生成的向量圖（`tools/trace2svg.html`）。
舊的手繪版與前一版描邊圖都移到 `archive/`（已被 `.gitignore` 排除，不會推上 GitHub）。

> ⚠️ 如果描邊來源是 **Google Maps / Apple Maps 截圖**，公開發佈前請換掉（違反其條款）。改用 [OpenStreetMap](https://www.openstreetmap.org/) 或 [香港地圖服務](https://www.hkmapservice.gov.hk/) 的截圖即可，兩者都允許使用（OSM 需標註「© OpenStreetMap contributors」）。

想要**真實精度**，用 `tools/geo2svg.html`：

- 頁面上直接按「**抓香港海岸線**」或「**抓香港 18 區邊界**」→ 透過 Overpass API 即時查詢，不用自己找檔案
- 或拖入 `.geojson` / `.osm` / `.shp` / Geofabrik 的 `.shp.zip`
- 按「設為地圖底圖」（Spherse 內可一鍵寫回），或「下載 SVG」再手動上傳

輸出固定 1200×840（10:7），與地圖頁容器比例一致；標點是百分比座標，換底圖後位置不會亂跑。

> Overpass 與 Shapefile 都是即時在瀏覽器解析，沒有後端；`.osm.pbf` 二進位格式不支援，請先轉成 `.osm`。

## 上傳到 GitHub Pages

在專案外層執行（把 `<你的帳號>`、`<repo>` 換掉）：

```bash
cd oc-world
git init
git add .
git commit -m "OC 世界觀站"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

然後到 repo 的 **Settings → Pages**：

- Source：`Deploy from a branch`
- Branch：`main` / `/ (root)` → Save

約一分鐘後開 `https://<你的帳號>.github.io/<repo>/`。

之後每次更新內容，只要：

```bash
cd oc-world
git add -A
git commit -m "更新角色與故事"
git push
```

### 幾點提醒

- **公開 repo 等於公開設定內容**。`world.data.json` 會被任何人下載。想保密請用 private repo（GitHub Pages 需付費方案）或改部署到 Cloudflare Pages / Netlify（可設存取控制）。
- 上傳的角色圖在 `media/`，記得一起 commit，否則線上會破圖。
- 本機預覽請用 `python3 -m http.server 8000` 再開 `http://localhost:8000/`，直接雙擊 `index.html` 會因為 `file://` 的 CORS 限制讀不到 JSON。
