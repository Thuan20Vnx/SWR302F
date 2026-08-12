import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncRoute, isSafeString } from '../middleware.js';
import { Subject } from '../models/Subject.js';
import { Voucher } from '../models/Voucher.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';

const router = Router();

async function quote(body) {
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const product = body?.product === 'trick' ? 'trick' : body?.product === 'exam' ? 'exam' : '';
  if (!isSafeString(subject, 40) || !product) return { error: 'Sản phẩm không hợp lệ' };
  const subjectDoc = await Subject.findOne({ id: subject }).lean();
  const originalPrice = Number(subjectDoc?.[product === 'exam' ? 'examPrice' : 'trickPrice'] || 20_000);
  const voucherCode = typeof body?.voucherCode === 'string' ? body.voucherCode.trim().toUpperCase() : '';
  let voucher = null;
  let discount = 0;
  if (voucherCode) {
    voucher = await Voucher.findOne({ code: voucherCode, active: true }).lean();
    const valid = voucher &&
      (!voucher.expiresAt || new Date(voucher.expiresAt) > new Date()) &&
      (!voucher.usageLimit || voucher.usedCount < voucher.usageLimit) &&
      (voucher.product === 'all' || voucher.product === product) &&
      (voucher.subject === '*' || voucher.subject === subject);
    if (!valid) return { error: 'Voucher không hợp lệ hoặc đã hết hạn' };
    discount = voucher.type === 'percent'
      ? Math.round(originalPrice * Math.min(100, voucher.value) / 100)
      : Math.min(originalPrice, voucher.value);
  }
  return { subject, product, originalPrice, discount, finalPrice: originalPrice - discount, voucherCode, voucher };
}

router.post('/quote', requireAuth(), asyncRoute(async (req, res) => {
  const result = await quote(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { voucher, ...publicResult } = result;
  res.json(publicResult);
}));

router.post('/orders', requireAuth(), asyncRoute(async (req, res) => {
  const result = await quote(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const user = await User.findById(req.session.sub).lean();
  if (!user) return res.status(401).json({ error: 'User not found' });
  const existing = await Order.findOne({ userId: user._id, subject: result.subject, product: result.product, status: { $in: ['pending', 'active'] } }).lean();
  if (existing) return res.status(409).json({ error: 'Bạn đã có đơn chờ xử lý hoặc đã mở khóa sản phẩm này' });
  const order = await Order.create({
    userId: user._id,
    email: user.email,
    subject: result.subject,
    product: result.product,
    originalPrice: result.originalPrice,
    discount: result.discount,
    finalPrice: result.finalPrice,
    voucherCode: result.voucherCode,
  });
  res.status(201).json({ order: { id: order._id, status: order.status, finalPrice: order.finalPrice } });
}));

router.get('/orders', requireAuth(), asyncRoute(async (req, res) => {
  const orders = await Order.find({ userId: req.session.sub }, { userId: 0, __v: 0 }).sort({ createdAt: -1 }).lean();
  res.json({ orders });
}));

export default router;
