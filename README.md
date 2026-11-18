# NEON ARCADE 霓虹遊樂場

現代霓虹風格的網頁遊戲網站。純 HTML / CSS / JavaScript 打造，**零依賴、零建置、免安裝**，打開網頁就能玩。

## 收錄遊戲

| 遊戲 | 說明 | 操作 |
| --- | --- | --- |
| **霓虹打磚塊**<br>Neon Breakout | 霓虹磚牆、連擊倍率、四種強化道具（加寬擋板／三顆球／慢速／加命）、關卡遞增。桌機為 3:2 盤面，手機直向自動切成 7×9 直式盤面。 | `←` `→` / `A` `D`、`Space` 發射、`P` / `Esc` 暫停；手機可拖曳畫面或用畫面按鍵 |
| **霓虹貪食蛇**<br>Neon Snake | 平滑插值移動、金色光點（+35 分並加速）、每 5 顆食物提升等級。桌機 22×15 盤面，手機直向為 12×19 直立盤面。 | `↑` `↓` `←` `→` / `WASD`、`Space` / `P` / `Esc` 暫停；手機可滑動畫面或用方向鍵 |

兩款遊戲都支援**鍵盤與觸控**，最高分以 `localStorage` 存在本機。

## 功能亮點

- **霓虹視覺系統**：自訂 CSS 變數、漸層光暈、掃描線與賽博網格。
- **首頁遊戲選單**：卡片上的預覽畫面是即時 Canvas 動畫（打磚塊會自動打球、貪食蛇沿路徑巡遊）。
- **雜湊路由**：`#/play/brick`、`#/play/snake`，可直接分享連結、支援瀏覽器上一頁。
- **合成音效**：以 Web Audio API 即時產生 8-bit 音效，沒有任何音訊檔案，可全域靜音並記住設定。
- **自帶字型**：Space Grotesk + Noto Sans TC 子集化（每字重約 94 KB），離線也能正確顯示中文。
- **自適應畫質**：依裝置像素量與硬體資訊自動調整 DPR，並在瀏覽器節流 `requestAnimationFrame` 時用計時器保底推進遊戲。
- **無障礙與體驗細節**：`prefers-reduced-motion` 降低動態、`aria` 標籤、切換分頁自動暫停、安全區域 (`env(safe-area-inset-*)`) 適配。

## 專案結構

```
index.html              # 單頁網站：首頁、遊戲選單、玩法說明、遊戲畫面
css/styles.css          # 全部樣式（霓虹主題、響應式、遊戲 HUD）
js/sound.js             # Web Audio 合成音效引擎
js/games/brick.js       # 霓虹打磚塊（Canvas 遊戲引擎）
js/games/snake.js       # 霓虹貪食蛇（Canvas 遊戲引擎）
js/app.js               # 網站主控：路由、遊戲生命週期、HUD、覆蓋層、卡片預覽
assets/fonts/           # 自帶字型與授權說明
tools/subset-fonts.py   # 重新產生中文字型子集（改文案後執行）
```

## 本機執行

任何靜態伺服器都可以，例如：

```bash
python3 -m http.server 4173
# 開啟 http://localhost:4173/
```

> 直接用 `file://` 開啟也可以玩，但建議用 HTTP 伺服器以確保字型與音訊行為一致。

## 修改中文文案後

中文是子集化字型，新增的字需要重新產生字型檔，否則會退回系統字型：

```bash
pip install fonttools brotli
npm install --no-save @fontsource/noto-sans-tc@5.3.1
python3 tools/subset-fonts.py
```

## 瀏覽器支援

Chrome / Edge / Safari / Firefox 最新版本。使用 Canvas 2D、Web Audio API、`ResizeObserver`、`Pointer Events`。

## 授權

程式碼可自由使用。字型為 SIL Open Font License 1.1，詳見 [`assets/fonts/LICENSE.md`](assets/fonts/LICENSE.md)。
