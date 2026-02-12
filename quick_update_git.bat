@echo off
chcp 65001 > nul
echo ==========================================
echo       準備將變更推送到 GitHub
echo ==========================================
echo.

echo [1/4] 加入所有檔案變更 (git add)...
git add .

echo.
echo [2/4] 提交變更 (git commit)...
git commit -m "Update: auto-update by assistant"
if %errorlevel% neq 0 (
    echo [提示] 沒有新的變更需要提交，或是這一步驟已在剛剛完成。繼續下一步...
)

echo.
echo [3/4] 從遠端同步更新 (git pull)...
echo 正在嘗試合併遠端的變更...
git pull origin main
if %errorlevel% neq 0 (
    echo [錯誤] git pull 發生衝突或錯誤。
    echo 請手動解決衝突後再執行此腳本。
    pause
    exit /b %errorlevel%
)

echo.
echo [4/4] 推送到遠端儲存庫 (git push)...
git push origin main
if %errorlevel% neq 0 (
    echo [錯誤] git push 失敗。請檢查網路或權限。
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo             更新完成！成功！
echo ==========================================
echo.
pause
