/* ---------------------------------------------------------------
   I'm AT - Swarm のチェックイン履歴を一覧して X などに共有する
----------------------------------------------------------------*/

'use strict';

const API = 'https://api.foursquare.com/v2';
const API_VERSION = '20230823';
const LIMIT = 100;
const LS_TOKEN = 'imsat_token';
const LS_UID = 'imsat_uid';

const el = (id) => document.getElementById(id);

const views = {
  connect: el('view-connect'),
  loading: el('view-loading'),
  error: el('view-error'),
  list: el('view-list'),
};

let token = null;
let clientId = null;
/** パーマリンクの組み立てに使う自分の Foursquare ユーザーID */
let userId = null;

/* --- ビュー切り替え -------------------------------------------- */

function show(name) {
  for (const [key, node] of Object.entries(views)) {
    node.hidden = key !== name;
  }
  el('topbar-actions').hidden = name !== 'list';
}

let toastTimer = null;
function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

/* --- 認証 ------------------------------------------------------ */

/** Foursquare に登録したものと完全一致させる必要がある（クエリもハッシュも付けない） */
function redirectUri() {
  return location.origin + location.pathname;
}

async function fetchClientId() {
  if (clientId) return clientId;
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('config');
  const data = await res.json();
  if (!data.client_id) throw new Error('config');
  clientId = data.client_id;
  return clientId;
}

async function connect() {
  const button = el('btn-connect');
  button.disabled = true;
  el('connect-note').textContent = '';
  try {
    const id = await fetchClientId();
    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri(),
    });
    location.href = `https://foursquare.com/oauth2/authenticate?${params}`;
  } catch (e) {
    button.disabled = false;
    el('connect-note').textContent =
      'サーバー側の設定（FSQ_CLIENT_ID）が読めませんでした。';
  }
}

async function exchangeCode(code) {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || 'トークンの取得に失敗しました');
  }
  return data.access_token;
}

function stripQuery() {
  history.replaceState(null, '', location.pathname);
}

function forgetSession() {
  try {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_UID);
  } catch (e) { /* noop */ }
  token = null;
  userId = null;
}

function disconnect() {
  if (!confirm('Foursquare から切断しますか？')) return;
  forgetSession();
  el('log').textContent = '';
  show('connect');
}

/* --- チェックイン取得 ------------------------------------------ */

async function fsq(path, params = {}) {
  const query = new URLSearchParams({
    oauth_token: token,
    v: API_VERSION,
    ...params,
  });
  const res = await fetch(`${API}${path}?${query}`);
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error(`foursquare ${res.status}`);
  const json = await res.json();
  return json.response;
}

/** パーマリンクの組み立てに要る。共有のたびに取りにいかなくて済むよう先に確保しておく */
async function ensureUserId() {
  if (userId) return;
  try { userId = localStorage.getItem(LS_UID); } catch (e) { /* noop */ }
  if (userId) return;
  try {
    const response = await fsq('/users/self');
    userId = response.user?.id || null;
    if (userId) {
      try { localStorage.setItem(LS_UID, userId); } catch (e) { /* noop */ }
    }
  } catch (e) {
    /* 取れなくても canonicalUrl で共有できるので致命ではない */
  }
}

async function loadCheckins() {
  show('loading');
  try {
    const [response] = await Promise.all([
      fsq('/users/self/checkins', { limit: String(LIMIT) }),
      ensureUserId(),
    ]);
    renderLog(response.checkins.items || []);
    show('list');
  } catch (e) {
    if (e.unauthorized) {
      forgetSession();
      el('connect-note').textContent = '接続の期限が切れました。もう一度つないでください。';
      show('connect');
      return;
    }
    el('error-text').textContent = navigator.onLine
      ? 'チェックインを読み込めませんでした。'
      : 'オフラインです。接続を確認してください。';
    show('error');
  }
}

async function refresh() {
  const button = el('btn-refresh');
  button.classList.add('is-spinning');
  button.disabled = true;
  try {
    await loadCheckins();
  } finally {
    button.classList.remove('is-spinning');
    button.disabled = false;
  }
}

/* --- 表示ヘルパ ------------------------------------------------ */

/** チェックイン地点のローカル時刻（timeZoneOffset は分単位） */
function localDate(checkin) {
  const offsetMin = typeof checkin.timeZoneOffset === 'number'
    ? checkin.timeZoneOffset
    : -new Date().getTimezoneOffset();
  return new Date((checkin.createdAt + offsetMin * 60) * 1000);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function dayKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function dayLabel(date) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const yesterday = new Date(today.getTime() - 86400000);
  const yKey = `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;
  const key = dayKey(date);

  const base = `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
    + `（${WEEKDAYS[date.getUTCDay()]}）`;
  if (key === todayKey) return `今日 ・ ${base}`;
  if (key === yKey) return `きのう ・ ${base}`;
  return base;
}

function timeLabel(date) {
  const h = date.getUTCHours();
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** 「杉並区, 東京都」。取れない項目は詰めて出す */
function placeLabel(venue) {
  const loc = venue.location || {};
  const parts = [loc.city, loc.state].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return loc.country || loc.formattedAddress?.join(', ') || '';
}

/* --- 共有文面 --------------------------------------------------- */

/** Swarm 純正と同じ形。コメントの有無で文型が変わる */
function buildText(checkin, url) {
  const place = `${checkin.venue.name} in ${placeLabel(checkin.venue)}`.trim();
  const shout = (checkin.shout || '').trim();
  const body = shout ? `${shout}（@ ${place}）` : `I'm at ${place}`;
  return url ? `${body} ${url}` : body;
}

/**
 * swarmapp.com の署名つきパーマリンク。
 * 一覧の canonicalUrl（app.foursquare.com/share/checkin/...?s=署名）に署名が入っているので、
 * そこから取り出して組み直す。共有のたびに API を叩かないのが肝心で、
 * 非同期を挟むとユーザー操作の有効期限が切れて window.open も navigator.share も弾かれる。
 */
function permalink(checkin) {
  const canonical = checkin.canonicalUrl || '';
  let signature = '';
  try {
    signature = new URL(canonical).searchParams.get('s') || '';
  } catch (e) { /* noop */ }

  if (userId && signature) {
    return `https://swarmapp.com/user/${userId}/checkin/${checkin.id}?s=${signature}`;
  }
  return canonical;
}

/* --- 共有アクション --------------------------------------------- */
/* どちらもクリックから同期で呼ぶ。await を挟んではいけない */

function postToX(checkin) {
  const text = buildText(checkin, permalink(checkin));
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) location.href = url;
}

function shareCheckin(checkin) {
  const text = buildText(checkin, permalink(checkin));

  if (navigator.share) {
    navigator.share({ text }).catch((e) => {
      if (e.name !== 'AbortError') toast('共有できませんでした');
    });
    return;
  }

  navigator.clipboard.writeText(text)
    .then(() => toast('コピーしました'))
    .catch(() => prompt('コピーしてください', text));
}

/* --- 描画 ------------------------------------------------------- */

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">'
  + '<path d="M17.53 3h3.18l-6.95 7.94L21.94 21h-6.4l-5.01-6.55L4.8 21H1.62l7.43-8.49L1.36 3h6.56l4.53 5.99L17.53 3Zm-1.12 16.1h1.76L7.7 4.8H5.81l10.6 14.3Z"/></svg>';

const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 3v13M8 7l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>';

function renderLog(checkins) {
  const log = el('log');
  log.textContent = '';

  if (!checkins.length) {
    el('error-text').textContent = 'チェックインがまだありません。';
    show('error');
    return;
  }

  const shareLabel = navigator.share ? '共有' : 'コピー';
  let currentDay = null;

  for (const checkin of checkins) {
    if (!checkin.venue) continue;

    const date = localDate(checkin);
    const key = dayKey(date);

    if (key !== currentDay) {
      currentDay = key;
      const li = document.createElement('li');
      const mark = document.createElement('h2');
      mark.className = 'daymark';
      mark.textContent = dayLabel(date);
      li.append(mark);
      log.append(li);
    }

    const li = document.createElement('li');
    li.className = 'entry';

    const time = document.createElement('div');
    time.className = 'entry__time';
    time.textContent = timeLabel(date);

    const body = document.createElement('div');
    body.className = 'entry__body';

    const venue = document.createElement('h3');
    venue.className = 'entry__venue';
    venue.textContent = checkin.venue.name;
    if (checkin.visibility === 'private') {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = '非公開';
      venue.append(chip);
    }
    body.append(venue);

    const place = placeLabel(checkin.venue);
    if (place) {
      const p = document.createElement('p');
      p.className = 'entry__place';
      p.textContent = place;
      body.append(p);
    }

    const shout = (checkin.shout || '').trim();
    if (shout) {
      const p = document.createElement('p');
      p.className = 'entry__shout';
      p.textContent = shout;
      body.append(p);
    }

    const actions = document.createElement('div');
    actions.className = 'entry__actions';

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'btn btn--primary';
    xBtn.innerHTML = `${ICON_X}<span>X でポスト</span>`;
    xBtn.addEventListener('click', () => postToX(checkin));

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn btn--icon';
    shareBtn.setAttribute('aria-label', shareLabel);
    shareBtn.title = shareLabel;
    shareBtn.innerHTML = ICON_SHARE;
    shareBtn.addEventListener('click', () => shareCheckin(checkin));

    actions.append(xBtn, shareBtn);
    body.append(actions);

    li.append(time, body);
    log.append(li);
  }

  el('log-end').hidden = checkins.length < LIMIT;
}

/* --- 起動 ------------------------------------------------------- */

el('btn-connect').addEventListener('click', connect);
el('btn-refresh').addEventListener('click', refresh);
el('btn-disconnect').addEventListener('click', disconnect);
el('btn-retry').addEventListener('click', loadCheckins);

async function boot() {
  try { token = localStorage.getItem(LS_TOKEN); } catch (e) { token = null; }

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    stripQuery();
    el('connect-note').textContent = error === 'access_denied'
      ? '接続がキャンセルされました。'
      : `接続に失敗しました（${error}）`;
    show('connect');
    return;
  }

  if (code && !token) {
    show('loading');
    try {
      token = await exchangeCode(code);
      try { localStorage.setItem(LS_TOKEN, token); } catch (e) { /* noop */ }
      stripQuery();
    } catch (e) {
      stripQuery();
      el('connect-note').textContent = 'トークンの取得に失敗しました。もう一度お試しください。';
      show('connect');
      return;
    }
  } else if (code) {
    stripQuery();
  }

  if (!token) {
    show('connect');
    return;
  }

  await loadCheckins();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* noop */ });
  });
}
