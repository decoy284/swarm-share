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

### 1. Foursquare のプロジェクトを作る

**旧 `foursquare.com/developers/apps` は廃止済み**で、アクセスすると新しい
Developer Console にリダイレクトされる。v2 の OAuth 資格情報はプロジェクトの設定に移っている。

1. https://foursquare.com/developers/home にログイン
2. **Create a New Project**（名前は `I'm AT`）
3. プロジェクト名をクリック → 左メニューの **Settings**
4. **OAuth Authentication** セクションに `Client Id` と `Client Secret` がある
5. 同セクションで次を設定して **Save**

   | 項目 | 値 |
   | --- | --- |
   | Project URL | `https://swarm-share.pages.dev/` |
   | Redirect URL | `https://swarm-share.pages.dev/` と `http://localhost:8788/` |

Redirect URL は複数登録できるコンボボックス。入力したあと候補に出る
`Add "..."` をクリックしないとタグとして確定しない。

- **末尾のスラッシュまで完全一致**させる。ここがズレると認可後に戻ってこられない
- ハッシュ（`#/auth` など）は**付けない**。フラグメントはサーバーに送られないので、
  `?code=` がフラグメントの後ろに付いてしまい、`location.search` から読めなくなる

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

URL は一覧のレスポンスに入っている `canonicalUrl`
（`https://app.foursquare.com/share/checkin/{id}?s={署名}&lang=ja`）から署名を取り出して、
`https://swarmapp.com/user/{userId}/checkin/{id}?s={署名}` に組み直している。
`userId` は起動時に `GET /v2/users/self` で一度だけ取って localStorage に置く。

**共有処理に `await` を挟んではいけない。** クリックから同期で
`window.open` / `navigator.share` を呼ばないと、ユーザー操作の有効期限
（transient activation）が切れてポップアップも共有シートもブラウザに弾かれる。
`GET /v2/checkins/{id}` を共有時に叩く実装にしていたときは、これで実際に詰まった。

### コメント欄

一覧の各行にコメント欄がある。Swarm 側のコメント（shout）が初期値で、
その場で書き換えて共有できる。空にすれば `I'm at …` の文型に戻る（shout には巻き戻さない）。

書きかけは localStorage（`imsat_drafts`）に置く。X アプリへ切り替えている間に
PWA が裏で落とされても消えないようにするため。一覧から外れたチェックインの分は
読み込みのたびに掃除する。

### Android では X アプリを直接開く

`window.open('https://x.com/intent/post?...')` だと、X アプリが起動したあとに
**x.com のカスタムタブが居残る**。Web 側はログインしていないのでログイン画面が残り、
毎回閉じることになる。

Android では Chrome が解釈する `intent:` URI を使って X アプリを直接呼ぶ。

```
intent://x.com/intent/post?text=<text>#Intent;scheme=https;package=com.twitter.android;S.browser_fallback_url=<web>;end
```

**独自スキーム（`twitter://post?message=`）は使わない。** 今の X アプリはこれで本文を拾わず、
空の投稿画面が開く。App Link と同じ `https://x.com/intent/post?text=` を
そのまま X アプリ宛てに投げるのが正解で、こうすると web 経由のときと同じ本文が入る。

アプリが入っていなければ Chrome が `browser_fallback_url` に落としてくれるので、
未インストールでも Web の intent 画面にはたどり着く。

---

## 使っている API

| 用途 | エンドポイント |
| --- | --- |
| 認可 | `https://foursquare.com/oauth2/authenticate?response_type=code` |
| トークン交換 | `https://foursquare.com/oauth2/access_token`（Functions 側） |
| 一覧 | `GET /v2/users/self/checkins?limit=100` |
| ユーザーID | `GET /v2/users/self`（起動時に1回だけ） |

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
