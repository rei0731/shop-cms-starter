import { type Ctx, detectImageType, json, requireAuth } from '../_lib.ts';

const MAX = 4 * 1024 * 1024; // 4MB（KV の1値あたり上限 25MB に対して十分小さく）
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as const;
const KEEP = 200; // 一覧に残す件数

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const denied = await requireAuth(ctx);
  if (denied) return denied;
  const { request, env } = ctx;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '送信が壊れています' }, 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: '画像が選ばれていません' }, 400);
  if (file.size > MAX) return json({ error: '画像が大きすぎます（4MBまで）' }, 413);

  const buf = await file.arrayBuffer();
  // 申告された種類ではなく、中身の先頭バイトで判定する
  const type = detectImageType(new Uint8Array(buf.slice(0, 12)));
  if (!type) return json({ error: '画像（JPEG/PNG/WebP/GIF）として読み取れません' }, 400);

  const name = `up_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}.${EXT[type]}`;
  await env.CMS.put(`img:${name}`, buf, { metadata: { type } });

  const raw = await env.CMS.get('imglist');
  const list: string[] = raw ? JSON.parse(raw) : [];
  list.unshift(`up/${name}`);
  await env.CMS.put('imglist', JSON.stringify(list.slice(0, KEEP)));

  return json({ ok: true, path: `up/${name}` });
}
