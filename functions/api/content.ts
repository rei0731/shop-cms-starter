import { type Ctx, json, requireAuth } from '../_lib.ts';

const KEY = 'content';
const MAX_BYTES = 400_000;
/** 保存時に必ず要るセクション。導入先の構成に合わせて変える */
export const REQUIRED_SECTIONS = ['hero', 'info'] as const;

// 読み取りは誰でも（サイトの表示に使うため）
export async function onRequestGet({ env }: Ctx): Promise<Response> {
  const saved = await env.CMS.get(KEY);
  // 404 を返すと、フロントは同梱の data/content.json に切り替えて表示する
  if (!saved) return json({ error: 'not found' }, 404);
  return new Response(saved, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 保存はログイン必須
export async function onRequestPut(ctx: Ctx): Promise<Response> {
  const denied = await requireAuth(ctx);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: '内容が壊れています' }, 400);
  }

  // 壊れたデータを保存してサイトが真っ白になる事故を防ぐ
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      REQUIRED_SECTIONS.some((k) => typeof body[k] !== 'object' || body[k] === null)) {
    return json({ error: '内容の形式が正しくありません' }, 400);
  }

  const text = JSON.stringify(body);
  if (text.length > MAX_BYTES) return json({ error: '内容が大きすぎます' }, 413);

  await ctx.env.CMS.put(KEY, text);
  return json({ ok: true, savedAt: new Date().toISOString() });
}
