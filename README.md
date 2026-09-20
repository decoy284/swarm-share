# I'm AT

Swarm（Foursquare）のチェックイン履歴を一覧して、X やほかのアプリにワンタップで共有する PWA。

🔗 https://swarm-share.pages.dev

[amay077/swarm-check-ins](https://github.com/amay077/swarm-check-ins) 由来。違いは次の3点。

- **PWA**（manifest + Service Worker）なので、Android ではホーム画面アイコンに Chrome のバッジが付かない
- **トークン交換を自前の Cloudflare Pages Functions で持つ**。他人のバックエンドに依存しない
- **X への投稿は intent URL**。X API の登録も審査も不要

---

## 構成

```
index.html              画面（1画面のみ）
app.js                  OAuth・一覧取得・共有
styles.css              配色とレイアウト
sw.js                   Service Worker（ネットワーク優先）
manifest.webmanifest    PWA マニフェスト
_headers                Cloudflare Pages のレスポンスヘッダー
icons/                  アイコン（SVG 原本 + 書き出した PNG）
functions/api/config.js GET  /api/config  → client_id を返す
functions/api/token.js  POST /api/token   → 認可コードをトークンに交換
```

ビルドなし。素の HTML / CSS / JS。

---

## セットアップ

### 1. Foursquare アプリを登録する

https://foursquare.com/developers/apps で **Create a new app**。

| 項目 | 値 |
| --- | --- |
| App name | I'm AT |
| Redirect URI(s) | `https://swarm-share.pages.dev/`<br>`http://localhost:8788/` |

- **末尾のスラッシュまで完全一致**させる。ここがズレると認可後に戻ってこられない
- ハッシュ（`#/auth` など）は**付けない**。フラグメントはサーバーに送られないので、
  `?code=` がフラグメントの後ろに付いてしまい、`location.search` から読めなくなる

発行された **Client ID** と **Client Secret** を控える。

### 2. Cloudflare Pages につなぐ

1. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git
2. `decoy284/swarm-share` を選ぶ
3. ビルド設定は **なし**（Framework preset: None / Build command: 空 / Output directory: `/`）
4. Settings → Environment variables に登録（Production と Preview の両方）

   | 変数名 | 値 |
   | --- | --- |
   | `FSQ_CLIENT_ID` | Foursquare の Client ID |
   | `FSQ_CLIENT_SECRET` | Foursquare の Client Secret（Secret 指定で暗号化） |

5. 再デプロイ

### 3. ローカルで動かす

```bash
cp .dev.vars.example .dev.vars   # 値を入れる
npx wrangler pages dev .
```

`http://localhost:8788/` で開く。Functions も一緒に動く。

---

## 共有される文面

Swarm 純正と同じ形。コメント（shout）の有無で文型が変わる。

```
コメントなし: I'm at 方南ロマンス食堂 in 杉並区, 東京都 https://swarmapp.com/user/…/checkin/…?s=…
コメントあり: うまかった（@ 方南ロマンス食堂 in 杉並区, 東京都） https://swarmapp.com/user/…/checkin/…?s=…
```

URL は `GET /v2/checkins/{id}` の `checkinShortUrl`。署名（`?s=`）つきのパーマリンクが
そのまま返ってくるので、非公開チェックインでもリンクが開ける。
一覧のレスポンスには含まれないので、共有ボタンを押したときに取りにいく（結果はメモ化）。

---

## 使っている API

| 用途 | エンドポイント |
| --- | --- |
| 認可 | `https://foursquare.com/oauth2/authenticate?response_type=code` |
| トークン交換 | `https://foursquare.com/oauth2/access_token`（Functions 側） |
| 一覧 | `GET /v2/users/self/checkins?limit=100` |
| パーマリンク | `GET /v2/checkins/{id}` |

v2 の checkins 系は 2026-06 以降も無料枠で維持されている。

アクセストークンはブラウザの localStorage（キー `imsat_token`）だけに置く。
サーバーには保存しない。

---

## Service Worker の方針

[[pwa-service-worker-pitfalls]] で踏んだ罠を最初から避けてある。

- **ネットワーク優先**。`CACHE_NAME` の bump 忘れで更新が届かない事故を起こさない
- `fetch(e.request)` を**そのまま**渡す（URL から作り直すとリダイレクトでナビゲーションが死ぬ）
- `ASSETS` とフォールバックは `/`（正規URL）で書く。`/index.html` では噛み合わない
- キャッシュの掃除は接頭辞 `imsat-` でスコープする
- `/api/*` と外部オリジンは素通し

---

## ライセンス

MIT
