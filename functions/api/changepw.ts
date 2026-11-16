import { type Ctx, hashPassword, json, penalty, requireAuth, timingSafeEqual } from '../_lib.ts';

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const denied = await requireAuth(ctx);
  if (denied) return denied;
  const { request, env } = ctx;
  if (!env.PW_SALT) return json({ error: 'サーバーの設定が未完了です' }, 500);

  let body: { current?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: '不正なリクエストです' }, 400);
  }
  const cur = typeof body?.current === 'string' ? body.current : '';
  const next = typeof body?.next === 'string' ? body.next : '';
  if (next.length < 8) return json({ error: '新しいパスワードは8文字以上にしてください' }, 400);

  const stored = (await env.CMS.get('pwhash')) || env.ADMIN_PW_HASH || '';
  if (!timingSafeEqual(await hashPassword(cur, env.PW_SALT), stored)) {
    await penalty();
    return json({ error: '今のパスワードが違います' }, 401);
  }

  await env.CMS.put('pwhash', await hashPassword(next, env.PW_SALT));
  return json({ ok: true });
}
