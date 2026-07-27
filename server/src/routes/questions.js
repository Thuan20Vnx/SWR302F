import { Router } from 'express';
import { asyncRoute } from '../middleware.js';
import { Question } from '../models/Question.js';

const router = Router();

// Bộ câu hỏi là dữ liệu công khai của app nên không yêu cầu đăng nhập.
// Client tự cache lại trong localStorage để dùng được cả khi server ngủ.
router.get('/', asyncRoute(async (req, res) => {
  const questions = await Question.find({}, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 })
    .sort({ id: 1 })
    .lean();

  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    count: questions.length,
    questions: questions.map((question) => ({
      ...question,
      options: Object.fromEntries(Object.entries(question.options || {})),
    })),
  });
}));

export default router;
