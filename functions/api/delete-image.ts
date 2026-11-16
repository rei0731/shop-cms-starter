import { type Ctx, json, requireAuth } from '../_lib.ts';

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const denied = await requireAuth(ctx);
  if (denied) return denied;
  const { request, env } = ctx;

  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: '不正なリクエストです' }, 400);
  }

  const path = typeof body?.path === 'string' ? body.path : ''; // 例: 'up/up_xxx.jpg'
  if (!path.startsWith('up/')) return json({ error: '同梱画像は削除できません' }, 400);
  const name = path.slice(3);
  if (!/^[\w.-]+$/.test(name)) return json({ error: '不正な名前です' }, 400);

  await env.CMS.delete(`img:${name}`);
  const raw = await env.CMS.get('imglist');
  const list: string[] = raw ? JSON.parse(raw) : [];
  await env.CMS.put('imglist', JSON.stringify(list.filter((p) => p !== path)));
  return json({ ok: true });
}
