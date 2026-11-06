import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure } from './validation.js';

const scrypt = promisify(scryptCallback);
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const cookieName = () =>
  process.env.NODE_ENV === 'production' ? '__Host-nova-session' : 'nova-session';
export const credentialHash = () =>
  digest(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD_HASH}`);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [method, salt, hash] = encoded.split(':');
  if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash))
    throw new Error('Invalid password hash configuration');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
function tokenHash(req) {
  const token = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName()}=`))
    ?.split('=')[1];
  return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : '';
}
export function setCookie(res, token, age) {
  res.setHeader(
    'Set-Cookie',
    `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}
export async function requireSession(db, req) {
  const session = await db.database.collection('sessions').findOne({
    _id: tokenHash(req),
    credential_hash: credentialHash(),
    expires_at: { $gt: new Date() },
  });
  ensure(session, 'Inicia sesión para continuar.', 401);
}
export async function login(db, req, res, body) {
  ensure(
    typeof body.username === 'string' &&
      body.username.length <= 100 &&
      typeof body.password === 'string' &&
      body.password.length >= 1 &&
      body.password.length <= 256,
    'Credenciales inválidas.',
  );
  // One administrator: a shared database counter works across serverless instances.
  const expired = { $lte: [{ $ifNull: ['$reset_at', new Date(0)] }, '$$NOW'] };
  const limit = await db.database.collection('login_limits').findOneAndUpdate(
    { _id: 'admin' },
    [
      {
        $set: {
          attempts: { $cond: [expired, 1, { $add: ['$attempts', 1] }] },
          reset_at: { $cond: [expired, { $add: ['$$NOW', 15 * 60 * 1000] }, '$reset_at'] },
        },
      },
    ],
    { upsert: true, returnDocument: 'after', includeResultMetadata: false },
  );
  if (limit.attempts > 20) res.setHeader('Retry-After', '900');
  ensure(limit.attempts <= 20, 'Demasiados intentos. Espera 15 minutos.', 429);
  const validPassword = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH);
  ensure(
    validPassword && body.username === process.env.ADMIN_USERNAME,
    'Usuario o contraseña incorrectos.',
    401,
  );
  const token = randomBytes(32).toString('hex');
  await db.database.collection('sessions').deleteMany({
    $or: [{ expires_at: { $lte: new Date() } }, { credential_hash: { $ne: credentialHash() } }],
  });
  await db.database.collection('sessions').insertOne({
    _id: digest(token),
    credential_hash: credentialHash(),
    expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000),
  });
  setCookie(res, token, 8 * 60 * 60);
  return { authenticated: true };
}
export async function logout(db, req, res) {
  await db.database.collection('sessions').deleteOne({ _id: tokenHash(req) });
  setCookie(res, '', 0);
  return { authenticated: false };
}
