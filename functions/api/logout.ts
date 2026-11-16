import { COOKIE, json } from '../_lib.ts';

export async function onRequestPost(): Promise<Response> {
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  });
}
