import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageType, getCookie, hashPassword, makeSession, timingSafeEqual, verifySession,
} from '../functions/_lib.ts';

const SECRET = 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

test('セッション: 作った値は検証を通る', async () => {
  const token = await makeSession(SECRET);
  assert.equal(await verifySession(SECRET, token), true);
});

test('セッション: 有効期限を書き換えると落ちる', async () => {
  const token = await makeSession(SECRET);
  const [exp, sig] = token.split('.');
  const forged = `${Number(exp) + 10 * 3600 * 1000}.${sig}`;
  assert.equal(await verifySession(SECRET, forged), false);
});

test('セッション: 期限切れは落ちる', async () => {
  const past = Date.now() - 2 * 3600 * 1000;
  const token = await makeSession(SECRET, 1, past);
  assert.equal(await verifySession(SECRET, token), false);
});

test('セッション: 別の鍵で作った値・空・壊れた値は落ちる', async () => {
  assert.equal(await verifySession(SECRET, await makeSession('other-secret')), false);
  assert.equal(await verifySession(SECRET, null), false);
  assert.equal(await verifySession(SECRET, 'abc'), false);
  assert.equal(await verifySession(SECRET, 'notanumber.sig'), false);
});

test('パスワード: 同じ入力なら同じハッシュ、ソルトが違えば別のハッシュ', async () => {
  const a = await hashPassword('correct horse', 'salt-a');
  assert.equal(a, await hashPassword('correct horse', 'salt-a'));
  assert.notEqual(a, await hashPassword('correct horse', 'salt-b'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

test('getCookie: 名前が前方一致する別のCookieと取り違えない', () => {
  const req = new Request('https://x/', { headers: { Cookie: 'xcms_sess=bad; cms_sess=good%3D' } });
  assert.equal(getCookie(req, 'cms_sess'), 'good=');
  assert.equal(getCookie(req, 'none'), null);
});

test('画像判定: 先頭バイトで種類を見分け、偽装を弾く', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(12).fill(0)]);
  assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff)), 'image/jpeg');
  assert.equal(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47)), 'image/png');
  assert.equal(detectImageType(bytes(0x47, 0x49, 0x46, 0x38)), 'image/gif');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(detectImageType(webp), 'image/webp');
  // "RIFF" だけでは WebP とみなさない（WAV なども RIFF で始まる）
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  assert.equal(detectImageType(wav), null);
  // HTML を画像と偽った場合
  assert.equal(detectImageType(new TextEncoder().encode('<script>alert(1)</script>')), null);
});
