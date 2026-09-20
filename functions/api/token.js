/**
 * POST /api/token  { code, redirect_uri }
 *
 * Foursquare の認可コードをアクセストークンに交換する。
 * client_secret をブラウザに出さないために、この一手だけサーバー側で持つ。
 */
export async function onRequestPost({ request, env }) {
  if (!env.FSQ_CLIENT_ID || !env.FSQ_CLIENT_SECRET) {
    return json({ error: 'FSQ_CLIENT_ID / FSQ_CLIENT_SECRET is not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
  if (!code || !redirectUri) {
    return json({ error: 'code and redirect_uri are required' }, 400);
  }

  /* 自分のオリジン宛て以外は受け付けない */
  const origin = new URL(request.url).origin;
  if (!redirectUri.startsWith(origin)) {
    return json({ error: 'redirect_uri mismatch' }, 400);
  }

  const params = new URLSearchParams({
    client_id: env.FSQ_CLIENT_ID,
    client_secret: env.FSQ_CLIENT_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  let upstream;
  try {
    upstream = await fetch(`https://foursquare.com/oauth2/access_token?${params}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch (e) {
    return json({ error: 'foursquare に接続できませんでした' }, 502);
  }

  const data = await upstream.json().catch(() => null);

  if (!upstream.ok || !data || !data.access_token) {
    const detail = data?.error_description || data?.error || `status ${upstream.status}`;
    return json({ error: `トークンの取得に失敗しました: ${detail}` }, 502);
  }

  return json({ access_token: data.access_token });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
