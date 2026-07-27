import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

export function signSession(user, deviceId) {
  return jwt.sign(
    { sub: user._id.toString(), deviceId },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
}

export function verifySession(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

const COOKIE_NAME = 'swr302_session';

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export function requireAuth() {
  return (req, res, next) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      req.session = verifySession(token);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid session' });
    }
  };
}

export { COOKIE_NAME };
