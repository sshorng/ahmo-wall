@echo off
echo ==========================================
echo       準備將變更推送到 GitHub
echo ==========================================
echo.

echo [1/3] 加入所有檔案變更 (git add)...
git add .
if %errorlevel% neq 0 (
    echo [錯誤] git add 失敗。請確認是否已安裝 Git 並在系統路徑中。
    pause
    exit /b %errorlevel%
)

echo.
echo [2/3] 提交變更 (git commit)...
git commit -m "Update: auto-update by assistant"
if %errorlevel% neq 0 (
    echo [注意] 可能沒有新的變更需要提交，或者發生錯誤。
    echo 繼續嘗試推送...
)

echo.
echo [3/3] 推送到遠端儲存庫 (git push)...
git push origin main
if %errorlevel% neq 0 (
    echo [錯誤] git push 失敗。請檢查您的網路連線或 GitHub 權限。
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo             更新完成！成功！
echo ==========================================
echo.
pause
