import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncRoute, isSafeString } from '../middleware.js';
import { isAdminEmail } from '../admin.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';

const router = Router();

function profile(user) {
  return {
    stars: user.stars instanceof Map ? Object.fromEntries(user.stars) : (user.stars || {}),
    highlights: user.highlights instanceof Map ? Object.fromEntries(user.highlights) : (user.highlights || {}),
    entitlements: user.entitlements || { examSubjects: [], trickSubjects: [] },
  };
}

router.get('/', requireAuth(), asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.sub).lean();
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(profile(user));
}));

router.put('/highlights/:questionId', requireAuth(), asyncRoute(async (req, res) => {
  const questionId = Number(req.params.questionId);
  const terms = Array.isArray(req.body?.terms)
    ? [...new Set(req.body.terms.map((term) => String(term).trim()).filter(Boolean))].slice(0, 20)
    : null;
  if (!Number.isInteger(questionId) || questionId < 1 || !terms) {
    return res.status(400).json({ error: 'Highlight không hợp lệ' });
  }
  if (terms.some((term) => term.length > 180)) {
    return res.status(400).json({ error: 'Mỗi đoạn highlight tối đa 180 ký tự' });
  }
  await User.updateOne(
    { _id: req.session.sub },
    { $set: { [`highlights.${questionId}`]: terms } },
  );
  res.json({ ok: true, questionId, terms });
}));

router.post('/exam-complete', requireAuth(), asyncRoute(async (req, res) => {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const score = Number(req.body?.score);
  if (!isSafeString(subject, 40) || !Number.isFinite(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'Kết quả bài thi không hợp lệ' });
  }
  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const allowed = isAdminEmail(user.email) || user.entitlements?.examSubjects?.includes(subject);
  if (!allowed) return res.status(403).json({ error: 'Bạn chưa mở khóa bài thi mô phỏng của môn này' });

  const earned = score >= 8 ? 2 : score >= 5 ? 1 : 0;
  const current = Number(user.stars?.get(subject) || 0);
  user.stars.set(subject, current + earned);
  await user.save();
  res.json({ ok: true, earned, stars: current + earned });
}));

router.get('/tricks', requireAuth(), asyncRoute(async (req, res) => {
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  if (!isSafeString(subject, 40)) return res.status(400).json({ error: 'Thiếu mã môn' });
  const user = await User.findById(req.session.sub).lean();
  if (!user) return res.status(401).json({ error: 'User not found' });

  const stars = Number(user.stars instanceof Map ? user.stars.get(subject) : user.stars?.[subject] || 0);
  const purchased = isAdminEmail(user.email) || user.entitlements?.trickSubjects?.includes(subject);
  const questions = await Question.find(
    { subject, 'tricks.0': { $exists: true } },
    { _id: 0, id: 1, tricks: 1 },
  ).sort({ id: 1 }).lean();

  const packs = new Map();
  questions.forEach((question) => {
    (question.tricks || []).forEach((trick) => {
      const pack = Math.max(1, Number(trick.pack) || 1);
      if (!packs.has(pack)) packs.set(pack, []);
      packs.get(pack).push({ questionId: question.id, content: trick.content });
    });
  });

  res.json({
    subject,
    stars,
    purchased,
    packs: [...packs.entries()].map(([pack, items]) => {
      const requiredStars = pack * 2;
      const unlocked = purchased || stars >= requiredStars;
      return {
        pack,
        requiredStars,
        count: items.length,
        unlocked,
        items: unlocked ? items : [],
      };
    }),
  });
}));

export default router;
