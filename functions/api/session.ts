// 管理画面の起動時に「今ログインしているか」を確かめる
import { COOKIE, type Ctx, getCookie, json, verifySession } from '../_lib.ts';

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const loggedIn = env.SESSION_SECRET
    ? await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
    : false;
  return json({ loggedIn });
}
