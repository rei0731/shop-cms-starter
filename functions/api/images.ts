import { type Ctx, json, requireAuth } from '../_lib.ts';

// サイトに同梱している写真（導入先ごとに public/images/ の中身に合わせる）
const BUILTIN = [
  'hero', 'concept', 'menu1', 'menu2', 'menu3', 'menu4',
  'gallery1', 'gallery2', 'gallery3', 'gallery4', 'gallery5', 'gallery6', 'staff',
].map((n) => `images/${n}.jpg`);

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const denied = await requireAuth(ctx);
  if (denied) return denied;
  const raw = await ctx.env.CMS.get('imglist');
  const uploaded: string[] = raw ? JSON.parse(raw) : [];
  return json({ images: uploaded.concat(BUILTIN) });
}
