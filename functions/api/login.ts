import { COOKIE, SESSION_HOURS, type Ctx, hashPassword, json, makeSession, penalty, timingSafeEqual } from '../_lib.ts';

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  if (!env.SESSION_SECRET || !env.PW_SALT) return json({ error: 'サーバーの設定が未完了です' }, 500);

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: '不正なリクエストです' }, 400);
  }
  const pw = typeof body?.password === 'string' ? body.password : '';
  if (!pw) return json({ error: 'パスワードを入力してください' }, 400);

  // 変更後のパスワードは KV に入る。無ければ初期パスワード（環境変数）を使う。
  // cacheTtl: 60 は最小値。パスワード変更は最大1分で全拠点に反映される。
  const stored = (await env.CMS.get('pwhash', { cacheTtl: 60 })) || env.ADMIN_PW_HASH;
  if (!stored) return json({ error: 'サーバーの設定が未完了です' }, 500);

  if (!timingSafeEqual(await hashPassword(pw, env.PW_SALT), stored)) {
    await penalty();
    return json({ error: 'パスワードが違います' }, 401);
  }

  const token = await makeSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`,
  });
}
