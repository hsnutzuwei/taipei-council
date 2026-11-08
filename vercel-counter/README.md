# Vercel 全站計數服務

網站維持 GitHub Pages。此資料夾單獨部署到 Vercel，搭配 Upstash Redis 儲存累計次數，不能使用函式記憶體或臨時檔案當資料庫。尚未部署。

手機可操作，建議瀏覽器開啟「電腦版網站」。

1. 把此資料夾（vercel-counter）與新版 index.html 放進 GitHub repository。
2. Vercel → Add New → Project → 匯入 taipei-council，Root Directory 選 `vercel-counter`，Framework Preset 選 Other，再部署。
3. 在專案 Storage／Marketplace 新增並連接 **Upstash Redis**。選擇前確認方案與費用；連接後應出現 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`，或 `KV_REST_API_URL`、`KV_REST_API_TOKEN`。只保留伺服器環境變數，不要加 NEXT_PUBLIC_ 或貼到聊天。
4. Settings → Environment Variables 新增 `HASH_SECRET`：自己產生至少 32 位元組的隨機秘密，僅存 Vercel。`ALLOWED_ORIGIN` 預設為 `https://hsnutzuwei.github.io`，自訂網域時才需修改。重新部署讓環境變數生效。
5. 確認計數服務的正式 Production 網址可供公開讀取，沒有要求 Vercel 登入。若啟用了 Deployment Protection，調整此計數專案的正式部署存取設定；不要在前端填入保護繞過密鑰。
6. 例如正式網址為 `https://your-counter.vercel.app`，將 HTML 中 `COUNTER_API` 填為 `https://your-counter.vercel.app/api`，再上傳 index.html 到 GitHub Pages。
7. 開正式網站，姓名在畫面停留至少一秒、選 2–3 人開始比較，確認數字增加。重新整理與同一天重複操作不重複計數；另一個瀏覽器可看到共用累計。GET `/api/counts` 應回傳 JSON 而非登入頁。

## 計數與安全限制

固定 98 個候選人 ID；只接受 view/compare 事件，不接受客戶端指定數字、日期或歸零。Redis Lua 原子處理每天去重與增量，避免同時請求重複計數。瀏覽器 UUID 同一天每候選人每種類最多計一次。臺北時間換日；換裝置、清除儲存、無痕視窗仍可能被算不同訪客。

每個網路來源每小時最多 240 次事件請求，共用網路可能受影響。原始 IP 不寫入資料庫，僅用 Vercel 提供的 x-vercel-forwarded-for 計算每日 HMAC；平台本身仍處理網路資料。計數資料長期保留，去重鍵在最近一次使用後 48 小時到期，限流鍵 2 小時到期。連接 Upstash 時保留其資料庫持久化設定，不使用帶有自動淘汰累計鍵的設定。

來源限制和限流只能減少基本濫用，不能防止有意偽造請求或大量分散來源。數字不是民調、支持度或真實訪客人數。出現濫用時可加 Turnstile/WAF。讀取失敗不顯示假零。沒有歷史統計，從啟用後開始累計。

服務沒有修改候選人資料的功能，也沒有公開重設計數介面。資料庫權杖與 HASH_SECRET 只能留在 Vercel，請勿上傳 GitHub。全站計數啟用前，HTML 顯示「尚未啟用」。
