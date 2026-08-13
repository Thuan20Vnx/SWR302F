import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncRoute, isSafeString } from '../middleware.js';
import { isAdminEmail } from '../admin.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';

const router = Router();

function hasTrickAccess(user, subject) {
  if (isAdminEmail(user.email)) return true;
  if (subject && user.entitlements?.trickSubjects?.includes(subject)) return true;
  if (user.entitlements?.trickSubjects?.length > 0) return true;
  const starsMap = user.stars instanceof Map ? user.stars : new Map(Object.entries(user.stars || {}));
  for (const [, val] of starsMap.entries ? starsMap.entries() : Object.entries(starsMap)) {
    if (Number(val) >= 7) return true;
  }
  return false;
}

function profile(user) {
  const entitlements = user.entitlements || {};
  return {
    stars: user.stars instanceof Map ? Object.fromEntries(user.stars) : (user.stars || {}),
    highlights: user.highlights instanceof Map ? Object.fromEntries(user.highlights) : (user.highlights || {}),
    entitlements: {
      examSubjects: entitlements.examSubjects || [],
      trickSubjects: entitlements.trickSubjects || [],
      examAttempts: entitlements.examAttempts ?? 1,
      isExamUnlimited: entitlements.isExamUnlimited ?? false,
    },
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

  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const questionDoc = await Question.findOne({ id: questionId }, { subject: 1 }).lean();
  const subject = questionDoc?.subject || '';
  if (!hasTrickAccess(user, subject)) {
    return res.status(403).json({ error: 'Vui lòng mua Gói tạo trick lỏ hoặc đạt 7 ngôi sao để sử dụng tính năng highlight!' });
  }

  await User.updateOne(
    { _id: req.session.sub },
    { $set: { [`highlights.${questionId}`]: terms } },
  );
  res.json({ ok: true, questionId, terms });
}));

router.get('/download-keyword-pdf', requireAuth(), asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!hasTrickAccess(user, '')) {
    return res.status(403).json({ error: 'Bạn cần mua Gói tạo trick lỏ hoặc đạt 7 ngôi sao để tải file này!' });
  }
  const filePath = path.resolve(process.cwd(), '../key_word_wdu.pdf');
  res.download(filePath, 'key_word_wdu.pdf', (err) => {
    if (err && !res.headersSent) {
      const altPath = path.resolve(process.cwd(), 'key_word_wdu.pdf');
      res.download(altPath, 'key_word_wdu.pdf');
    }
  });
}));

router.post('/use-exam-attempt', requireAuth(), asyncRoute(async (req, res) => {
  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const isAdmin = isAdminEmail(user.email);
  const isUnlimited = user.entitlements?.isExamUnlimited;
  if (isAdmin || isUnlimited) {
    return res.json({ ok: true, remaining: 'unlimited' });
  }
  const currentAttempts = user.entitlements?.examAttempts ?? 1;
  if (currentAttempts <= 0) {
    return res.status(403).json({ error: 'Bạn đã hết lượt test mô phỏng. Vui lòng mua thêm gói test.' });
  }
  user.entitlements.examAttempts = currentAttempts - 1;
  await user.save();
  res.json({ ok: true, remaining: user.entitlements.examAttempts });
}));

router.post('/exam-complete', requireAuth(), asyncRoute(async (req, res) => {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const score = Number(req.body?.score);
  if (!isSafeString(subject, 40) || !Number.isFinite(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'Kết quả bài thi không hợp lệ' });
  }
  const user = await User.findById(req.session.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const allowed = isAdminEmail(user.email) || user.entitlements?.isExamUnlimited || (user.entitlements?.examAttempts ?? 0) >= 0 || user.entitlements?.examSubjects?.includes(subject);
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
