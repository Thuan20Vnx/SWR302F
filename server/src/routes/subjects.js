import { Router } from 'express';
import { asyncRoute } from '../middleware.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';

const router = Router();

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const [configured, counted] = await Promise.all([
      Subject.find({}, { _id: 0, id: 1, label: 1, questionCount: 1, examPrice: 1, trickPrice: 1, active: 1 }).sort({ label: 1 }).lean(),
      Question.aggregate([{ $group: { _id: '$subject', questionCount: { $sum: 1 } } }]),
    ]);
    const byId = new Map(configured.map((subject) => [subject.id, subject]));
    counted.forEach(({ _id, questionCount }) => {
      const current = byId.get(_id) || { id: _id, label: _id, examPrice: 20_000, trickPrice: 20_000, active: true };
      byId.set(_id, { ...current, questionCount });
    });
    const subjects = [...byId.values()].filter((subject) => subject.active !== false).sort((a, b) => a.label.localeCompare(b.label));

    res.json({
      subjects: subjects.map((subject) => ({
        id: subject.id,
        label: subject.label,
        note: `Bộ đề do admin nhập · ${subject.questionCount} câu`,
        questionCount: subject.questionCount,
        examPrice: subject.examPrice || 20_000,
        trickPrice: subject.trickPrice || 20_000,
      })),
    });
  }),
);

export default router;
