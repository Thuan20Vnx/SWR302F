import { Router } from 'express';
import { asyncRoute, isSafeString } from '../middleware.js';
import { requireAdmin } from '../admin.js';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { Voucher } from '../models/Voucher.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { applyOrderBenefits } from './commerce.js';

const router = Router();
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{2,40}$/;
const LETTERS = ['A', 'B', 'C', 'D'];

function positiveInteger(value, max) {
  return Number.isInteger(value) && value > 0 && value <= max;
}

export function validateImport(body) {
  const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : '';
  const subjectName = typeof body.subjectName === 'string' ? body.subjectName.trim() : '';
  const rows = Array.isArray(body.questions) ? body.questions : [];

  if (!SUBJECT_ID_PATTERN.test(subjectId)) {
    return { error: 'Mã môn chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới (2-40 ký tự)' };
  }
  if (!isSafeString(subjectName, 80)) {
    return { error: 'Tên môn phải có từ 1 đến 80 ký tự' };
  }
  if (!rows.length || rows.length > 1000) {
    return { error: 'Mỗi lần import cần từ 1 đến 1000 câu hỏi' };
  }

  const questions = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const line = index + 2;
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    const answer = typeof row.answer === 'string'
      ? [...new Set(row.answer.toUpperCase().replace(/[^A-D]/g, ''))].sort().join('')
      : '';
    const options = Object.fromEntries(
      LETTERS.map((letter) => [letter, String(row.options?.[letter] || '').trim()])
        .filter(([, value]) => value),
    );

    if (!positiveInteger(row.page, 10_000) || !positiveInteger(row.numberOnPage, 1_000)) {
      return { error: `Dòng ${line}: page và number_on_page phải là số nguyên dương` };
    }
    if (!isSafeString(question, 2_000)) {
      return { error: `Dòng ${line}: nội dung câu hỏi đang trống hoặc quá dài` };
    }
    if (!options.A || !options.B) {
      return { error: `Dòng ${line}: bắt buộc có ít nhất đáp án A và B` };
    }
    if (Object.values(options).some((option) => !isSafeString(option, 1_000))) {
      return { error: `Dòng ${line}: mỗi lựa chọn phải ngắn hơn 1.000 ký tự` };
    }
    if (!answer || [...answer].some((letter) => !options[letter])) {
      return { error: `Dòng ${line}: answer phải là chữ cái của đáp án đang có, ví dụ A hoặc BD` };
    }

    questions.push({
      subject: subjectId,
      page: row.page,
      numberOnPage: row.numberOnPage,
      question,
      options,
      answer,
      duplicateOf: null,
    });
  }

  return { subjectId, subjectName, questions };
}

router.post(
  '/questions/import',
  ...requireAdmin(),
  asyncRoute(async (req, res) => {
    const parsed = validateImport(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { subjectId, subjectName, questions } = parsed;
    const replaceExisting = req.body.replaceExisting === true;
    const existingCount = await Question.countDocuments({ subject: subjectId });
    if (existingCount && !replaceExisting) {
      return res.status(409).json({
        error: `Môn ${subjectId} đã có ${existingCount} câu. Chọn “Thay thế bộ câu hỏi hiện có” để cập nhật.`,
      });
    }

    const maxQuestion = await Question.findOne({}, { id: 1, _id: 0 }).sort({ id: -1 }).lean();
    const previousSubject = await Subject.findOne({ id: subjectId }).lean();
    const firstId = Number(maxQuestion?.id || 0) + 1;
    const documents = questions.map((question, index) => ({
      ...question,
      id: firstId + index,
    }));
    const importedIds = documents.map((question) => question.id);

    await Question.insertMany(documents, { ordered: true });
    try {
      await Subject.updateOne(
        { id: subjectId },
        {
          $set: {
            label: subjectName,
            questionCount: documents.length,
            importedBy: req.adminEmail,
          },
        },
        { upsert: true },
      );
      if (replaceExisting) {
        await Question.deleteMany({ subject: subjectId, id: { $nin: importedIds } });
      }
    } catch (error) {
      await Question.deleteMany({ id: { $in: importedIds } });
      if (previousSubject) {
        await Subject.updateOne(
          { id: subjectId },
          {
            $set: {
              label: previousSubject.label,
              questionCount: previousSubject.questionCount,
              importedBy: previousSubject.importedBy,
            },
          },
          { upsert: true },
        );
      } else {
        await Subject.deleteOne({ id: subjectId });
      }
      throw error;
    }

    res.status(201).json({
      ok: true,
      subject: {
        id: subjectId,
        label: subjectName,
        note: `Bộ đề do admin nhập · ${documents.length} câu`,
      },
      count: documents.length,
    });
  }),
);

router.get('/snapshot', ...requireAdmin(), asyncRoute(async (req, res) => {
  const [configuredSubjects, questionSubjects, questions, vouchers, orders] = await Promise.all([
    Subject.find({}, { __v: 0 }).sort({ label: 1 }).lean(),
    Question.aggregate([
      { $group: { _id: '$subject', questionCount: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Question.find({}, { _id: 0, __v: 0 }).sort({ subject: 1, id: 1 }).limit(5000).lean(),
    Voucher.find({}, { __v: 0 }).sort({ createdAt: -1 }).lean(),
    Order.find({}, { __v: 0 }).sort({ createdAt: -1 }).limit(300).lean(),
  ]);
  const subjects = new Map(configuredSubjects.map((subject) => [subject.id, subject]));
  questionSubjects.forEach(({ _id, questionCount }) => {
    const configured = subjects.get(_id);
    subjects.set(_id, configured
      ? { ...configured, questionCount }
      : { id: _id, label: _id, questionCount, examPrice: 20_000, trickPrice: 20_000, active: true });
  });
  res.json({
    subjects: [...subjects.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    questions: questions.map((question) => ({ ...question, options: Object.fromEntries(Object.entries(question.options || {})) })),
    vouchers,
    orders,
  });
}));

router.post('/subjects', ...requireAdmin(), asyncRoute(async (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (!SUBJECT_ID_PATTERN.test(id) || !isSafeString(label, 80)) {
    return res.status(400).json({ error: 'Mã hoặc tên môn không hợp lệ' });
  }
  const subject = await Subject.create({
    id,
    label,
    examPrice: Math.max(0, Number(req.body.examPrice) || 20_000),
    trickPrice: Math.max(0, Number(req.body.trickPrice) || 20_000),
    importedBy: req.adminEmail,
  });
  res.status(201).json({ subject });
}));

router.put('/subjects/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (!isSafeString(label, 80)) return res.status(400).json({ error: 'Tên môn không hợp lệ' });
  const subject = await Subject.findOneAndUpdate(
    { id: req.params.id },
    { $set: {
      id: req.params.id,
      label,
      examPrice: Math.max(0, Number(req.body.examPrice) || 0),
      trickPrice: Math.max(0, Number(req.body.trickPrice) || 0),
      active: req.body.active !== false,
    } },
    { new: true, upsert: true },
  );
  res.json({ subject });
}));

router.delete('/subjects/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const [subject, questions] = await Promise.all([
    Subject.findOneAndDelete({ id: req.params.id }),
    Question.deleteMany({ subject: req.params.id }),
  ]);
  if (!subject && !questions.deletedCount) return res.status(404).json({ error: 'Không tìm thấy môn học' });
  res.json({ ok: true, deletedQuestions: questions.deletedCount });
}));

function validateQuestion(body, partial = false) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const options = Object.fromEntries(
    LETTERS.map((letter) => [letter, String(body?.options?.[letter] || '').trim()]).filter(([, value]) => value),
  );
  const answer = typeof body?.answer === 'string'
    ? [...new Set(body.answer.toUpperCase().replace(/[^A-D]/g, ''))].sort().join('')
    : '';
  if (!partial && !SUBJECT_ID_PATTERN.test(String(body?.subject || ''))) return { error: 'Mã môn không hợp lệ' };
  if (!isSafeString(question, 2_000) || !options.A || !options.B || !answer) return { error: 'Câu hỏi, A, B và đáp án là bắt buộc' };
  if ([...answer].some((letter) => !options[letter])) return { error: 'Đáp án không khớp lựa chọn' };
  return {
    value: {
      subject: String(body.subject || ''),
      page: Math.max(1, Math.trunc(Number(body.page) || 1)),
      numberOnPage: Math.max(1, Math.trunc(Number(body.numberOnPage) || 1)),
      question,
      options,
      answer,
      duplicateOf: null,
    },
  };
}

router.post('/questions', ...requireAdmin(), asyncRoute(async (req, res) => {
  const parsed = validateQuestion(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const maxQuestion = await Question.findOne({}, { id: 1 }).sort({ id: -1 }).lean();
  const question = await Question.create({ ...parsed.value, id: Number(maxQuestion?.id || 0) + 1 });
  await Subject.updateOne({ id: question.subject }, { $inc: { questionCount: 1 } });
  res.status(201).json({ question });
}));

router.put('/questions/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const existing = await Question.findOne({ id: Number(req.params.id) });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  const questionText = typeof req.body?.question === 'string' ? req.body.question.trim() : existing.question;
  const rawOptions = req.body?.options || existing.options || {};
  const options = Object.fromEntries(
    LETTERS.map((letter) => [letter, String(rawOptions[letter] || '').trim()]).filter(([, value]) => value),
  );
  const rawAnswer = typeof req.body?.answer === 'string' ? req.body.answer : existing.answer;
  const answer = [...new Set(rawAnswer.toUpperCase().replace(/[^A-D]/g, ''))].sort().join('');

  if (!isSafeString(questionText, 2_000) || !options.A || !options.B || !answer) {
    return res.status(400).json({ error: 'Nội dung câu hỏi, lựa chọn A, B và đáp án đúng là bắt buộc' });
  }
  if ([...answer].some((letter) => !options[letter])) {
    return res.status(400).json({ error: 'Đáp án đúng phải là chữ cái thuộc các đáp án đã có (A, B, C, D)' });
  }

  const page = req.body?.page !== undefined ? Math.max(1, Math.trunc(Number(req.body.page) || 1)) : existing.page;
  const numberOnPage = req.body?.numberOnPage !== undefined ? Math.max(1, Math.trunc(Number(req.body.numberOnPage) || 1)) : existing.numberOnPage;

  existing.question = questionText;
  existing.options = options;
  existing.answer = answer;
  existing.page = page;
  existing.numberOnPage = numberOnPage;
  if (req.body?.subject && SUBJECT_ID_PATTERN.test(req.body.subject)) {
    existing.subject = req.body.subject;
  }

  await existing.save();
  res.json({ ok: true, question: existing });
}));

router.delete('/questions/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const question = await Question.findOneAndDelete({ id: Number(req.params.id) });
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });
  await Subject.updateOne({ id: question.subject }, { $inc: { questionCount: -1 } });
  res.json({ ok: true });
}));

router.put('/questions/:id/tricks', ...requireAdmin(), asyncRoute(async (req, res) => {
  const normalized = Array.isArray(req.body?.tricks)
    ? req.body.tricks.slice(0, 20).map((trick) => ({
        pack: Math.max(1, Math.min(100, Math.trunc(Number(trick.pack) || 1))),
        content: String(trick.content || '').trim().slice(0, 1200),
        createdBy: req.adminEmail,
      })).filter((trick) => trick.content)
    : [];
  const tricks = [...new Map(normalized.map((trick) => [trick.pack, trick])).values()];
  const current = await Question.findOne({ id: Number(req.params.id) }, { subject: 1 }).lean();
  if (!current) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });
  for (const trick of tricks) {
    const packSize = await Question.countDocuments({
      subject: current.subject,
      id: { $ne: Number(req.params.id) },
      tricks: { $elemMatch: { pack: trick.pack } },
    });
    if (packSize >= 50) return res.status(409).json({ error: `Pack ${trick.pack} đã đủ 50 câu` });
  }
  const question = await Question.findOneAndUpdate(
    { id: Number(req.params.id) },
    { $set: { tricks } },
    { new: true },
  );
  res.json({ question });
}));

router.post('/vouchers', ...requireAdmin(), asyncRoute(async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return res.status(400).json({ error: 'Mã voucher không hợp lệ' });
  const voucher = await Voucher.create({
    code,
    type: req.body.type === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, Number(req.body.value) || 0),
    product: ['exam', 'trick'].includes(req.body.product) ? req.body.product : 'all',
    subject: typeof req.body.subject === 'string' && req.body.subject ? req.body.subject : '*',
    usageLimit: Math.max(0, Math.trunc(Number(req.body.usageLimit) || 0)),
    expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
    createdBy: req.adminEmail,
  });
  res.status(201).json({ voucher });
}));

router.put('/vouchers/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const voucher = await Voucher.findByIdAndUpdate(req.params.id, { $set: {
    active: req.body.active !== false,
    usageLimit: Math.max(0, Math.trunc(Number(req.body.usageLimit) || 0)),
    expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
  } }, { new: true });
  if (!voucher) return res.status(404).json({ error: 'Không tìm thấy voucher' });
  res.json({ voucher });
}));

router.delete('/vouchers/:id', ...requireAdmin(), asyncRoute(async (req, res) => {
  const voucher = await Voucher.findByIdAndDelete(req.params.id);
  if (!voucher) return res.status(404).json({ error: 'Không tìm thấy voucher' });
  res.json({ ok: true });
}));

router.post('/orders/:id/activate', ...requireAdmin(), asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, status: 'pending' });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn đang chờ' });
  order.status = 'active';
  order.activatedBy = req.adminEmail;
  await order.save();
  await applyOrderBenefits(order);
  if (order.voucherCode) await Voucher.updateOne({ code: order.voucherCode }, { $inc: { usedCount: 1 } });
  res.json({ order });
}));

router.post('/orders/:id/cancel', ...requireAdmin(), asyncRoute(async (req, res) => {
  const order = await Order.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { $set: { status: 'cancelled', activatedBy: req.adminEmail } }, { new: true });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn đang chờ' });
  res.json({ order });
}));

export default router;
