import { Router } from 'express';
import { asyncRoute } from '../middleware.js';
import { Question } from '../models/Question.js';

const router = Router();

// Bộ câu hỏi là dữ liệu công khai của app nên không yêu cầu đăng nhập.
// Client tự cache lại trong localStorage để dùng được cả khi server ngủ.
router.get('/', asyncRoute(async (req, res) => {
  // Không truyền subject thì trả cả kho, giữ tương thích với bản client cũ.
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  const filter = subject ? { subject } : {};

  const questions = await Question.find(filter, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 })
    .sort({ id: 1 })
    .lean();

  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    subject: subject || null,
    count: questions.length,
    questions: questions.map((question) => ({
      ...question,
      options: Object.fromEntries(Object.entries(question.options || {})),
    })),
  });
}));

export default router;
