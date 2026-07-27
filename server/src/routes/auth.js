import { Router } from 'express';
import { User } from '../models/User.js';
import { asyncRoute, isSafeString } from '../middleware.js';
import {
  verifyGoogleToken,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} from '../auth.js';

const router = Router();
const MAX_DEVICES = Number(process.env.MAX_DEVICES || 3);

function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

router.post(
  '/google',
  asyncRoute(async (req, res) => {
  const { credential, deviceId, userAgent } = req.body || {};
  // Bắt buộc là chuỗi: object lọt xuống sẽ thành ValidationError của Mongoose.
  if (!isSafeString(credential, 4096) || !isSafeString(deviceId, 100)) {
    return res.status(400).json({ error: 'Missing credential or deviceId' });
  }
  const safeUserAgent = isSafeString(userAgent, 300) ? userAgent : '';

  let payload;
  try {
    payload = await verifyGoogleToken(credential);
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  let user = await User.findOne({ googleId: payload.sub });
  const isNewUser = !user;

  if (!user) {
    user = new User({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || '',
      picture: payload.picture || '',
      devices: [],
    });
  } else {
    user.name = payload.name || user.name;
    user.picture = payload.picture || user.picture;
  }

  const now = new Date();
  const existingDevice = user.devices.find((d) => d.deviceId === deviceId);
  if (existingDevice) {
    existingDevice.lastSeenAt = now;
    existingDevice.userAgent = safeUserAgent || existingDevice.userAgent;
  } else {
    user.devices.push({ deviceId, userAgent: safeUserAgent, createdAt: now, lastSeenAt: now });
  }

  let evictedDevice = null;
  if (user.devices.length > MAX_DEVICES) {
    const sorted = [...user.devices].sort(
      (a, b) => new Date(a.lastSeenAt) - new Date(b.lastSeenAt),
    );
    const toEvict = sorted.slice(0, user.devices.length - MAX_DEVICES);
    const evictIds = new Set(toEvict.map((d) => d.deviceId));
    evictedDevice = toEvict.find((d) => d.deviceId !== deviceId) || null;
    user.devices = user.devices.filter((d) => !evictIds.has(d.deviceId));
  }

  await user.save();

  const token = signSession(user, deviceId);
  setSessionCookie(res, token);

  res.json({
    user: publicUser(user),
    isNewUser,
    deviceCount: user.devices.length,
    maxDevices: MAX_DEVICES,
    evictedDevice: evictedDevice ? { deviceId: evictedDevice.deviceId } : null,
  });
  }),
);

router.get(
  '/me',
  requireAuth(),
  asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const stillActive = user.devices.some((d) => d.deviceId === req.session.deviceId);
  if (!stillActive) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Device logged out', deviceEvicted: true });
  }

  res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  requireAuth(),
  asyncRoute(async (req, res) => {
  await User.updateOne(
    { _id: req.session.sub },
    { $pull: { devices: { deviceId: req.session.deviceId } } },
  );
  clearSessionCookie(res);
  res.json({ ok: true });
  }),
);

export default router;
