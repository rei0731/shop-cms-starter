// 共通処理：パスワード照合・セッション・画像判定。
// すべてサーバー側（Cloudflare Pages Functions）で動くので、ブラウザ側のJSを改ざんしても突破できない。

/** 使う分だけを定義した KV の型（@cloudflare/workers-types を入れなくても型検査できるように） */
export interface KV {
  get(key: string, opts?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string | ArrayBuffer, opts?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  getWithMetadata(
    key: string,
    opts: { type: 'arrayBuffer' },
  ): Promise<{ value: ArrayBuffer | null; metadata: { type?: string } | null }>;
}

export interface Env {
  CMS: KV;
  /** セッション署名鍵（40文字以上のランダム文字列） */
  SESSION_SECRET?: string;
  /** 初期パスワードのハッシュ（scripts/hash-password.mjs で作る） */
  ADMIN_PW_HASH?: string;
  /** パスワードハッシュのソルト（導入先ごとに変える） */
  PW_SALT?: string;
}

export interface Ctx {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

export const COOKIE = 'cms_sess';
export const SESSION_HOURS = 1;

const enc = new TextEncoder();

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 長さと中身を、かかる時間が変わらない方法で比べる（時間差から答えを推測されないように） */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * パスワードを PBKDF2-SHA256（10万回）でハッシュ化する。
 * Workers の上限が 10万回なので、それに合わせている。
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return toHex(bits);
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/** 「有効期限.署名」の形のセッション値を作る。期限を書き換えると署名が合わなくなる */
export async function makeSession(secret: string, hours = SESSION_HOURS, now = Date.now()): Promise<string> {
  const exp = String(now + hours * 3600 * 1000);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySession(secret: string, token: string | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  return timingSafeEqual(sig, await hmac(secret, exp));
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** ログイン済みなら null、未ログインならそのまま返せるエラー応答を返す */
export async function requireAuth({ request, env }: Ctx): Promise<Response | null> {
  if (!env.SESSION_SECRET) return json({ error: 'サーバーの設定が未完了です' }, 500);
  const ok = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE));
  return ok ? null : json({ error: 'ログインが必要です' }, 401);
}

/** 総当たりを遅くするための待ち時間 */
export const penalty = (ms = 700) => new Promise((r) => setTimeout(r, ms));

export type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** 先頭バイト（マジックナンバー）から画像の種類を判定する。拡張子や Content-Type の偽装対策 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WebP は "RIFF" ････ "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
