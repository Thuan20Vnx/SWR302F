import { Router } from 'express';
import { asyncRoute } from '../middleware.js';
import { User } from '../models/User.js';
import { requireAuth } from '../auth.js';

const router = Router();
const VALID_RATINGS = new Set(['known', 'again']);
const MAX_QUESTIONS = 2000;

// A session stays valid only while its device is still on the user's list,
// so a logged-out (or evicted) device cannot keep reading or overwriting data.
async function loadUser(req, res) {
  const user = await User.findById(req.session.sub);
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return null;
  }
  if (!user.devices.some((device) => device.deviceId === req.session.deviceId)) {
    res.status(401).json({ error: 'Device logged out', deviceEvicted: true });
    return null;
  }
  return user;
}

function publicProgress(user) {
  return {
    progress: Object.fromEntries(user.progress || []),
    savedQuestions: user.savedQuestions || [],
    sessions: user.sessions || 0,
    sessionsDate: user.sessionsDate || '',
    examSessions: Object.fromEntries(
      [...(user.examSessions || [])].map(([subject, session]) => [
        subject,
        session.toObject ? session.toObject() : session,
      ]),
    ),
    updatedAt: user.progressUpdatedAt,
  };
}

function sanitizeProgress(input) {
  if (!input || typeof input !== 'object') return null;
  const entries = Object.entries(input)
    .filter(([id, value]) => /^\d+$/.test(id) && VALID_RATINGS.has(value))
    .slice(0, MAX_QUESTIONS);
  return new Map(entries);
}

function sanitizeSaved(input) {
  if (!Array.isArray(input)) return null;
  return [
    ...new Set(
      input
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_QUESTIONS),
    ),
  ];
}

// Bài thi dở do client gửi lên, chỉ nhận đúng khuôn và có chặn kích thước.
const MAX_EXAM_QUESTIONS = 500;

function sanitizeExamSessions(input) {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object') return new Map();

  const entries = Object.entries(input)
    .slice(0, 20)
    .map(([subject, session]) => {
      if (!session || typeof session !== 'object') return null;
      const ids = (Array.isArray(session.ids) ? session.ids : [])
        .map(Number)
        .filter(Number.isInteger)
        .slice(0, MAX_EXAM_QUESTIONS);
      if (!ids.length) return null;

      return [
        String(subject).slice(0, 40),
        {
          subject: String(session.subject || subject).slice(0, 40),
          mode: session.mode === 'full' ? 'full' : 'practice',
          ids,
          index: Math.min(Math.max(Math.trunc(Number(session.index) || 0), 0), ids.length - 1),
          answers: ids.map((_, position) =>
            String(session.answers?.[position] || '')
              .toUpperCase()
              .replace(/[^A-F]/g, '')
              .slice(0, 6),
          ),
          checked: ids.map((_, position) => Boolean(session.checked?.[position])),
          deadline: Math.max(0, Math.trunc(Number(session.deadline) || 0)),
          startedAt: Math.max(0, Math.trunc(Number(session.startedAt) || 0)),
          updatedAt: Math.max(0, Math.trunc(Number(session.updatedAt) || 0)),
        },
      ];
    })
    .filter(Boolean);

  return new Map(entries);
}

router.get('/', requireAuth(), asyncRoute(async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  res.json(publicProgress(user));
}));

// Replaces the stored state with what the client sends (client merges on login).
router.put('/', requireAuth(), asyncRoute(async (req, res) => {
  const { progress, savedQuestions, sessions, sessionsDate, examSessions } =
    req.body || {};

  const nextProgress = sanitizeProgress(progress);
  const nextSaved = sanitizeSaved(savedQuestions);
  if (!nextProgress || !nextSaved) {
    return res.status(400).json({ error: 'Invalid progress payload' });
  }

  const user = await loadUser(req, res);
  if (!user) return;

  user.progress = nextProgress;
  user.savedQuestions = nextSaved;
  user.sessions = Number.isFinite(Number(sessions))
    ? Math.max(0, Math.trunc(Number(sessions)))
    : user.sessions;
  if (typeof sessionsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sessionsDate)) {
    user.sessionsDate = sessionsDate;
  }
  // Client cũ không gửi trường này, khi đó giữ nguyên bài dở đang lưu.
  const nextExams = sanitizeExamSessions(examSessions);
  if (nextExams) user.examSessions = nextExams;
  user.progressUpdatedAt = new Date();
  await user.save();

  res.json(publicProgress(user));
}));

export default router;
