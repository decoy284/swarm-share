/**
 * GET /api/config
 * クライアントに渡してよい設定だけを返す（client_id は秘密ではない）。
 * client_secret は絶対にここから出さない。
 */
export function onRequestGet({ env }) {
  if (!env.FSQ_CLIENT_ID) {
    return json({ error: 'FSQ_CLIENT_ID is not configured' }, 500);
  }
  return json({ client_id: env.FSQ_CLIENT_ID });
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
