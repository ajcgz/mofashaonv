# 在發佈版上直接編輯（GitHub 同步模式）

網站在 GitHub Pages 上沒有後端，所以預設是唯讀。但只要設定一次 GitHub Token，就能**在網站上直接編輯**，每次存檔會自動產生一個 commit。

## 一次性設定

### 1. 產生 Token

1. 到 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）
2. **Token name**：隨便取，例如 `oc-world-editor`
3. **Expiration**：建議 90 天（到期再換）
4. **Repository access**：選 `Only select repositories` → 只勾這個網站的 repo
5. **Permissions → Repository permissions → Contents**：改成 **Read and write**
6. 其他權限不用給 → 按 **Generate token** → 複製 `github_pat_...`

### 2. 貼進網站

1. 開網站 → 右上角 **⚙**
2. 填：
   - **owner**：你的 GitHub 帳號
   - **repo**：repo 名稱
   - **分支**：`main`
   - **Token**：剛剛複製的那串
3. 按 **測試連線**（成功會顯示 repo 全名）→ **儲存**
4. 之後右上角會出現「**編輯模式**」按鈕，標籤變成「GitHub 同步」

## 使用方式

跟平常一樣：編輯模式 → 新增／修改 → 存檔。

每次存檔 = 一個 commit，訊息格式 `更新：<mutation 名稱>（時間）`。
好處是**內容仍然留在 git 裡**，可以回溯、可以看差異。

## 安全性

- Token 只存在**這台裝置的瀏覽器**（localStorage），不會寫進 repo，別人看不到
- 公用電腦用完請按 ⚙ → **清除設定**
- Token 洩漏的風險：任何能操作你這台電腦的人可以讀到它。Token 只給單一 repo 的 Contents 權限，最壞情況是那個 repo 被改
- 想撤銷：GitHub → Settings → Developer settings → 刪掉那個 token

## 注意

- 存檔後 **Pages 需要 30–60 秒重新部署**，其他人要重新整理才看到；你自己這台會在本地立即更新（不會被舊快取蓋掉）
- 圖片上傳也會 commit 到 `media/`，檔名會加上時間戳避免撞名
- 如果同時在兩個地方編輯，後存的人會覆蓋前一個（GitHub API 會用最新的 sha，不會壞檔，但會蓋掉變更）
- 這個模式只在**發佈版**需要設定；在 Spherse 裡本來就能編輯，不需要 token
