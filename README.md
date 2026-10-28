# OC 世界觀站

一個記錄 **人物 / 關係圖 / 時間綫 / 地圖 / 故事 / 百科 / 音樂** 的靜態世界觀網站。所有內容存在一個 JSON 檔，頁面只負責渲染。

- **瀏覽**：任何地方都能開（GitHub Pages、本機、Spherse 預覽）
- **編輯**：在 Spherse 裡開這個頁面 → 右上「編輯模式」→ 直接在畫面上改
- **發佈**：改完把專案 commit & push，Pages 自動更新
- **線上版本是唯讀的**（沒有後端可寫檔）

---

## 檔案

```
魔法少女dse/                     ← 專案根目錄（推 GitHub 時從這裡推）
├─ index.html                    ← 專案入口（自動轉到 oc-world）
├─ .nojekyll                     ← 讓 GitHub Pages 不跑 Jekyll
├─ CHANGELOG.md                  ← 改動紀錄
├─ docs/                         ← 問卷、素材、說明書（不影響網站）
└─ oc-world/                     ← 網站本體
   ├─ index.html                 頁面骨架
   ├─ robots.txt
   ├─ .nojekyll
   ├─ assets/
   │  ├─ style.css               主樣式（考卷紙 × 冰雨）
   │  ├─ features.css            章節／圖鑑／雷達／深色主題等新功能樣式
   │  └─ app.js                  路由、渲染、關係圖、表單、讀寫、音樂
   ├─ data/
   │  └─ world.data.json         ★ 全部內容都在這裡
   ├─ media/                     圖片與音樂
   ├─ tools/                     地圖轉檔工具（不影響網站運作）
   └─ archive/                   備份與草稿（.gitignore 已排除）
```

只有 `index.html`、`assets/`、`data/`、`media/` 會影響網站。`tools/` 是輔助工具，`archive/` 是備份。

---

## 頁面

| 頁面 | 讀什麼 | 內容 |
| --- | --- | --- |
| **總覽** | `world` + 全部計數 | 全屏開卷首屏（倒轉時鐘、碎片粒子）、世界觀簡介、數字列、陣營、主要人物、時間綫速覽、百科、畫廊 |
| **人物** | `characters` / `relations` | 翻轉卡片牆（正面陣營標籤、背面簡介）、篩選與搜尋 |
| **角色詳情** | 同上 + `gallery` | 立繪區（多圖＋燈箱）、檔案面板、能力雷達圖、印象色／印象曲／腦內聲優、分頁：簡介／形態／圖鑑／軼事／台詞／畫廊 |
| **關係圖** | `characters` / `relations` | 力導向圖、頭像裁切節點、hover 高亮、拖動、連結模式、縮放工具列 |
| **時間綫** | `events` | 節點全部展開，可綁插圖與故事 |
| **地圖** | `map` / `places` | 底圖 + 百分比座標標點，可拖動 |
| **畫廊** | `gallery` | 圖片牆、燈箱 |
| **百科** | `entries` | 分類篩選、`[[詞條]]` 內鏈、相關詞條、反向連結 |
| **音樂** | `music` | 依「播放版面／角色頁」分組管理，可改名、試聽 |
| **故事** | `stories` | 章節列表（字數／日期／已讀）、閱讀器（上一章／下一章）、多視角切換、信件／日記／機密檔案版式 |

### 幾個特色

- **章節**：故事內文用一行 `=== 章節標題 ===` 分隔，自動分章；寫 `=== 2024-05-01 | 標題 ===` 可帶日期
- **多視角**：多篇故事綁同一個時間綫節點 → 閱讀頁出現視角選項卡
- **版式**：故事體裁選「信件／日記／檔案」會換紙張樣式，並用打字機效果逐字顯示
- **已讀進度**：存在瀏覽器（`localStorage`），不會寫進 repo
- **主題**：右上 ◐ 切換深／淺色，會記住選擇；沒選過時跟隨系統
- **音樂**：每頁／每個角色各自指定歌曲，隨機播放；聊天卡片內完全不出聲

---

## 資料模型

```jsonc
{
  "world":   { "name", "tagline", "intro", "era", "accent", "footer" },
  "map":     { "image", "note" },
  "characters": [
    { "id", "name", "alias", "role", "faction", "age", "birthday", "height", "bloodType",
      "tags", "summary", "story", "image",
      "hair", "eyes", "outfit", "habit", "keepsake", "color", "transformName", "transformLook",
      "personality", "strengths", "flaw", "petPeeve", "fear", "coping", "firstImpression",
      "want", "loseFear", "secret", "status", "trivia", "quotes",
      "voiceActor", "imprintSong", "stats", "outfits", "forms",
      "ability", "abilityLimit", "cost", "weakPoint",
      "family", "pastLife", "order" }
  ],
  "relations": [ { "id", "fromId", "toId", "type", "note", "order" } ],
  "stories":   [ { "id", "title", "body", "characters", "tags", "eventId", "pov", "form", "order" } ],
  "places":    [ { "id", "name", "category", "note", "characters", "x", "y", "order" } ],
  "events":    [ { "id", "title", "date", "body", "characters", "order" } ],
  "gallery":   [ { "id", "title", "image", "caption", "characters", "eventId", "order" } ],
  "entries":   [ { "id", "title", "category", "summary", "body", "related", "order" } ],
  "music":     [ { "id", "title", "src", "page", "order" } ]
}
```

### 格式規則

- `tags`／`characters`／`related` 是**逗號分隔字串**，不是陣列
- 段落用**空行**分段；支援 `**粗體**`、`*斜體*`、`> 引用`（行首）
- `relations.type` 只能是：`親屬` `摯友` `戀人` `師徒` `同盟` `敵對` `隸屬` `其他`
- `places.x` / `y` 是 **0–100 百分比座標**（左上為 0,0），換底圖不會跑位
- `music.page`：`all` / `home` / `characters` / `graph` / `timeline` / `map` / `gallery` / `wiki` / `stories`，或 `char:<角色ID>`（只在該角色頁播放）
- `stories.form`：`敘述` / `信件` / `日記` / `檔案`
- 以下欄位是多行文字，每行一項（用 `|` 分隔欄位）：
  - `stats` → `力量: 7`（0–10，至少 3 項才會畫雷達圖）
  - `forms` → `名稱 | 圖片 | 說明`（滑塊對比）
  - `outfits` → `名稱 | 類型 | 圖片 | 說明`（圖鑑）
  - `quotes` → `台詞 | 配音檔（可省略）`

---

## 編輯方式

**在頁面上編輯**（Spherse 內）

- 右上「編輯模式」→ 各頁出現新增／編輯／刪除按鈕
- 人物頁的台詞、軼事可以**原地編輯**，不用開大表單
- 所有寫入走 `$manifest` 具名 mutation，即時寫回 `world.data.json`

**請 AI 編輯**

AI 用 `read_data({ file: "oc-world/data/world.data.json" })` 看結構，再用 `query_data` / `mutate_data`：

`addCharacter`／`updateCharacter`／`removeCharacter`、關係三件套、`addStory` 系列、`addEvent` 系列、`addPlace` 系列、`addGallery` 系列、`addEntry` 系列、`addMusic` 系列、`updateWorld`、`updateMap`

> 新增欄位時，`app.js` 的 `CHAR_FIELDS` / `STORY_FIELDS` 與 JSON 的 `$manifest` 要一起改，否則寫入會被忽略。

**為甚麼線上版唯讀**

寫入能力來自 Spherse 注入的 `window.spherse`。GitHub Pages 只有靜態檔，沒有後端可寫入，所以偵測不到 SDK 時會自動切成唯讀（右上顯示「唯讀發佈版」）。

雲端寫入（GitHub Token）功能已停用，說明留在 `../docs/GITHUB-EDIT.md`。

---

## 地圖底圖

目前用 `media/hk-map-active.svg`（由截圖自動描邊生成，工具在 `tools/trace2svg.html`）。

> ⚠️ 如果描邊來源是 **Google Maps / Apple Maps 截圖**，公開發佈前請換掉（違反其條款）。改用 [OpenStreetMap](https://www.openstreetmap.org/) 或 [香港地圖服務](https://www.hkmapservice.gov.hk/) 的截圖即可（OSM 需標註「© OpenStreetMap contributors」）。

想要**真實精度**，用 `tools/geo2svg.html`：

- 頁面上按「抓香港海岸線」或「抓香港 18 區邊界」，透過 Overpass API 即時查詢
- 或拖入 `.geojson` / `.osm` / `.shp` / Geofabrik 的 `.shp.zip`
- 輸出固定 1200×840（10:7），與地圖容器比例一致

---

## 上傳到 GitHub Pages

從**專案根目錄**（有 `index.html` 的那一層）執行：

```bash
git init
git add .
git commit -m "OC 世界觀站"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

到 repo 的 **Settings → Pages**：

- Source：`Deploy from a branch`
- Branch：`main` / `/ (root)` → Save

約一分鐘後開 `https://<你的帳號>.github.io/<repo>/`（根目錄的 `index.html` 會自動轉到世界觀）。

之後每次更新：

```bash
git add -A
git commit -m "更新角色與故事"
git push
```

### 幾點提醒

- **公開 repo 等於公開設定內容**，`world.data.json` 任何人都能下載
- `media/` 裡的圖片與音樂記得一起 commit，否則線上會破圖、沒聲音
- 本機預覽用 `python3 -m http.server 8000` 再開 `http://localhost:8000/`；直接雙擊 `index.html` 會因 `file://` CORS 限制讀不到 JSON
- `archive/` 已被 `.gitignore` 排除，不會上傳

---

## 其他文件

| 檔案 | 內容 |
| --- | --- |
| `../docs/README.md` | 文檔索引、專案結構速覽 |
| `../docs/世界觀檢核問卷.txt` | 63 題查漏補缺問卷 |
| `../docs/GITHUB-EDIT.md` | 雲端寫入功能（已停用）與恢復步驟 |
| `media/README.md` | 圖片與音樂的命名規則 |
| `tools/README.md` | 地圖工具用法 |
