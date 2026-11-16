// API を、実際の Cloudflare 環境の代わりにメモリ上の KV で動かして確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, type Ctx, type Env, type KV, hashPassword, makeSession } from '../functions/_lib.ts';
import { onRequestPost as login } from '../functions/api/login.ts';
import { onRequestPost as changepw } from '../functions/api/changepw.ts';
import { onRequestGet as getContent, onRequestPut as putContent } from '../functions/api/content.ts';
import { onRequestPost as upload } from '../functions/api/upload.ts';
import { onRequestGet as serveImage } from '../functions/up/[name].ts';

class MemoryKV implements KV {
  store = new Map<string, { value: string | ArrayBuffer; metadata?: unknown }>();
  async get(key: string) {
    const v = this.store.get(key)?.value;
    return typeof v === 'string' ? v : null;
  }
  async put(key: string, value: string | ArrayBuffer, opts?: { metadata?: unknown }) {
    this.store.set(key, { value, metadata: opts?.metadata });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async getWithMetadata(key: string) {
    const e = this.store.get(key);
    return { value: (e?.value as ArrayBuffer) ?? null, metadata: (e?.metadata as { type?: string }) ?? null };
  }
}

const SALT = 'test-salt';
const SECRET = 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

async function makeEnv(): Promise<Env> {
  return { CMS: new MemoryKV(), SESSION_SECRET: SECRET, PW_SALT: SALT, ADMIN_PW_HASH: await hashPassword('initial-pw', SALT) };
}
const ctx = (request: Request, env: Env, params = {}): Ctx => ({ request, env, params });
const jsonReq = (method: string, body: unknown, cookie?: string) =>
  new Request('https://example.com/api', {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const authCookie = async () => `${COOKIE}=${await makeSession(SECRET)}`;

test('ログイン: 正しいパスワードで HttpOnly のセッションCookieが返る', async () => {
  const env = await makeEnv();
  const res = await login(ctx(jsonReq('POST', { password: 'initial-pw' }), env));
  assert.equal(res.status, 200);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  assert.match(cookie, new RegExp(`^${COOKIE}=\\d+\\.`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('ログイン: 間違ったパスワードは 401', async () => {
  const env = await makeEnv();
  const res = await login(ctx(jsonReq('POST', { password: 'wrong' }), env));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('ログイン: 設定が足りないサーバーは 500（素通りさせない）', async () => {
  const env = await makeEnv();
  delete env.PW_SALT;
  const res = await login(ctx(jsonReq('POST', { password: 'initial-pw' }), env));
  assert.equal(res.status, 500);
});

test('パスワード変更: 変更後は新しいパスワードでだけ入れる', async () => {
  const env = await makeEnv();
  const cookie = await authCookie();
  const res = await changepw(ctx(jsonReq('POST', { current: 'initial-pw', next: 'brand-new-pw' }, cookie), env));
  assert.equal(res.status, 200);
  assert.equal((await login(ctx(jsonReq('POST', { password: 'initial-pw' }), env))).status, 401);
  assert.equal((await login(ctx(jsonReq('POST', { password: 'brand-new-pw' }), env))).status, 200);
});

test('パスワード変更: 8文字未満は断る', async () => {
  const env = await makeEnv();
  const res = await changepw(ctx(jsonReq('POST', { current: 'initial-pw', next: 'short' }, await authCookie()), env));
  assert.equal(res.status, 400);
});

test('内容の保存: 未ログインは 401、ログイン済みなら保存されて読める', async () => {
  const env = await makeEnv();
  const content = { hero: { title: 'こんにちは' }, info: { tel: '000' } };
  assert.equal((await putContent(ctx(jsonReq('PUT', content), env))).status, 401);

  const res = await putContent(ctx(jsonReq('PUT', content, await authCookie()), env));
  assert.equal(res.status, 200);
  const got = await getContent(ctx(new Request('https://example.com/api/content'), env));
  assert.deepEqual(await got.json(), content);
});

test('内容の保存: 必須セクションが欠けたデータは保存しない', async () => {
  const env = await makeEnv();
  const res = await putContent(ctx(jsonReq('PUT', { hero: {} }, await authCookie()), env));
  assert.equal(res.status, 400);
  assert.equal((await getContent(ctx(new Request('https://example.com/'), env))).status, 404);
});

test('画像アップロード: 本物の PNG は保存・配信され、偽装ファイルは断る', async () => {
  const env = await makeEnv();
  const cookie = await authCookie();
  const send = (bytes: Uint8Array<ArrayBuffer>, type: string) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), 'x');
    return upload(ctx(new Request('https://example.com/api/upload', { method: 'POST', body: form, headers: { Cookie: cookie } }), env));
  };

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const ok = await send(png, 'image/png');
  assert.equal(ok.status, 200);
  const { path } = (await ok.json()) as { path: string };
  assert.match(path, /^up\/up_[\w]+\.png$/);

  const served = await serveImage(ctx(new Request('https://example.com/' + path), env, { name: path.slice(3) }));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('Content-Type'), 'image/png');

  // Content-Type だけ画像を名乗った HTML
  const fake = await send(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'image/png');
  assert.equal(fake.status, 400);
});

test('画像配信: パスをたどる名前は 404', async () => {
  const env = await makeEnv();
  const res = await serveImage(ctx(new Request('https://example.com/'), env, { name: '../content' }));
  assert.equal(res.status, 404);
});
