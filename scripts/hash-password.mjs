// 初期パスワードのハッシュを作る（ADMIN_PW_HASH に設定する値）
// 使い方: node scripts/hash-password.mjs <パスワード> <ソルト>
// functions/_lib.ts の hashPassword と同じ計算をする。
const [password, salt] = process.argv.slice(2);
if (!password || !salt) {
  console.error('使い方: node scripts/hash-password.mjs <パスワード> <ソルト>');
  process.exit(1);
}
const enc = new TextEncoder();
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 },
  key,
  256,
);
console.log(Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join(''));
