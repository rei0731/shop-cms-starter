// アップロードされた画像を配信する（誰でも見られる）
// ファイル名の [name] は動的ルート。角括弧ごとファイル名にする。
import type { Ctx } from '../_lib.ts';

export async function onRequestGet({ params, env }: Ctx): Promise<Response> {
  const name = String(params.name ?? '');
  if (!/^[\w.-]+$/.test(name)) return new Response('Not found', { status: 404 });

  const res = await env.CMS.getWithMetadata(`img:${name}`, { type: 'arrayBuffer' });
  if (!res?.value) return new Response('Not found', { status: 404 });

  return new Response(res.value, {
    headers: {
      'Content-Type': res.metadata?.type || 'image/jpeg',
      // 名前は毎回新しく作るので、中身が変わることはない → 長期キャッシュしてよい
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
