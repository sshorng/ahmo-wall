# 🚀 AhMo-Vue 部署指南 (GitHub + Vercel)

本專案使用 Vue 3 (Vite) + Firebase 開發，推薦使用 Vercel 進行部署。

## 步驟 1：準備 GitHub 倉庫
1. 在 [GitHub](https://github.com/new) 建立一個新的儲存庫。
2. 在本地終端執行：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <您的-GitHub-倉庫-網址>
   git push -u origin main
   ```

## 步驟 2：部署至 Vercel
1. 登入 [Vercel 控制台](https://vercel.com/dashboard)。
2. 點擊 **"Add New"** -> **"Project"**。
3. 匯入剛剛建立的 GitHub 儲存庫。
4. **重要設定**：
   - **Framework Preset**: 選擇 `Vite`。
   - **Root Directory**: `./`。
   - **Build Command**: `npm run build`。
   - **Output Directory**: `dist`。
5. 點擊 **"Deploy"**。

## 步驟 3：設定 Firebase 白名單 (重要)
部署成功後，您會得到一個網址（例如 `https://ahmo-vue.vercel.app`）。
1. 前往 [Firebase Console](https://console.firebase.google.com/)。
2. 進入 **Authentication** -> **Settings** -> **Authorized domains**。
3. 將 Vercel 提供的網址新增至白名單，否則 Google 登入將無法運作。

## 關於設定 (Settings)
部署完成後，請點擊頁面上的 **⚙️ (設定)** 圖標：
1. 貼上您的 Firebase Config。
2. 設定您的 Cloudinary 參數。
3. 儲存後，系統會自動將資料搬遷至您的雲端資料庫。
