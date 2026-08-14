import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncRoute, isSafeString } from '../middleware.js';
import { Subject } from '../models/Subject.js';
import { Voucher } from '../models/Voucher.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';

const router = Router();

function getBankConfig() {
  return {
    bankShortName: process.env.BANK_SHORT_NAME || 'MB',
    bankAccountNo: process.env.BANK_ACCOUNT_NO || '0898606575',
    bankAccountName: process.env.BANK_ACCOUNT_NAME || 'LE NGOC HOANG',
  };
}

function buildQrUrl(bankShortName, bankAccountNo, amount, content, bankAccountName) {
  return `https://img.vietqr.io/image/${bankShortName}-${bankAccountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(bankAccountName)}`;
}

export async function applyOrderBenefits(order) {
  if (order.product === 'exam') {
    if (order.packageOption === '30k_unlimited') {
      await User.updateOne(
        { _id: order.userId },
        {
          $addToSet: { 'entitlements.examSubjects': order.subject },
          $set: { 'entitlements.isExamUnlimited': true },
        },
      );
    } else if (order.packageOption === '10k_2') {
      await User.updateOne(
        { _id: order.userId },
        {
          $addToSet: { 'entitlements.examSubjects': order.subject },
          $inc: { 'entitlements.examAttempts': 2 },
        },
      );
    } else if (order.packageOption === '20k_5') {
      await User.updateOne(
        { _id: order.userId },
        {
          $addToSet: { 'entitlements.examSubjects': order.subject },
          $inc: { 'entitlements.examAttempts': 5 },
        },
      );
    } else {
      await User.updateOne(
        { _id: order.userId },
        {
          $addToSet: { 'entitlements.examSubjects': order.subject },
          $inc: { 'entitlements.examAttempts': 5 },
        },
      );
    }
  } else if (order.product === 'trick') {
    await User.updateOne(
      { _id: order.userId },
      { $addToSet: { 'entitlements.trickSubjects': order.subject } },
    );
  }
}

async function quote(body) {
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const product = body?.product === 'trick' ? 'trick' : body?.product === 'exam' ? 'exam' : '';
  if (!isSafeString(subject, 40) || !product) return { error: 'Sản phẩm không hợp lệ' };
  
  let originalPrice = 20000;
  let packageOption = typeof body?.packageOption === 'string' ? body.packageOption : '';

  if (product === 'exam') {
    if (packageOption === '10k_2') originalPrice = 10000;
    else if (packageOption === '20k_5') originalPrice = 20000;
    else if (packageOption === '30k_unlimited') originalPrice = 30000;
    else {
      packageOption = '20k_5';
      originalPrice = 20000;
    }
  } else {
    const subjectDoc = await Subject.findOne({ id: subject }).lean();
    originalPrice = Number(subjectDoc?.trickPrice || 20_000);
  }

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
  return { subject, product, packageOption, originalPrice, discount, finalPrice: Math.max(0, originalPrice - discount), voucherCode, voucher };
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
  const existing = await Order.findOne({ userId: user._id, subject: result.subject, product: result.product, packageOption: result.packageOption, status: { $in: ['pending', 'active'] } });
  
  if (existing) {
    if (existing.status === 'active') {
      return res.status(409).json({ error: 'Bạn đã sở hữu sản phẩm này' });
    }
    if (result.finalPrice === 0) {
      existing.status = 'active';
      existing.finalPrice = 0;
      existing.discount = result.originalPrice;
      existing.voucherCode = result.voucherCode;
      await existing.save();
      await applyOrderBenefits(existing);
      if (result.voucherCode) {
        await Voucher.updateOne({ code: result.voucherCode }, { $inc: { usedCount: 1 } });
      }
      return res.status(200).json({
        order: {
          id: existing._id,
          code: existing.code,
          status: 'active',
          finalPrice: 0,
          autoActivated: true,
        },
      });
    }
    const bank = getBankConfig();
    const qrUrl = buildQrUrl(bank.bankShortName, bank.bankAccountNo, existing.finalPrice, existing.code || existing._id.toString(), bank.bankAccountName);
    return res.status(200).json({
      order: {
        id: existing._id,
        code: existing.code,
        status: existing.status,
        finalPrice: existing.finalPrice,
        transferContent: existing.code || existing._id.toString(),
        qrUrl,
        bank,
      },
    });
  }

  const code = 'HC' + Math.floor(100000 + Math.random() * 900000);
  const isFree = result.finalPrice === 0;

  const order = await Order.create({
    userId: user._id,
    email: user.email,
    subject: result.subject,
    product: result.product,
    packageOption: result.packageOption,
    code,
    originalPrice: result.originalPrice,
    discount: result.discount,
    finalPrice: result.finalPrice,
    voucherCode: result.voucherCode,
    status: isFree ? 'active' : 'pending',
  });

  if (isFree) {
    await applyOrderBenefits(order);
    if (result.voucherCode) {
      await Voucher.updateOne({ code: result.voucherCode }, { $inc: { usedCount: 1 } });
    }
    return res.status(201).json({
      order: {
        id: order._id,
        code: order.code,
        status: 'active',
        finalPrice: 0,
        autoActivated: true,
      },
    });
  }

  const bank = getBankConfig();
  const transferContent = code;
  const qrUrl = buildQrUrl(bank.bankShortName, bank.bankAccountNo, order.finalPrice, transferContent, bank.bankAccountName);

  res.status(201).json({
    order: {
      id: order._id,
      code: order.code,
      status: order.status,
      finalPrice: order.finalPrice,
      transferContent,
      qrUrl,
      bank,
    },
  });
}));

router.get('/orders', requireAuth(), asyncRoute(async (req, res) => {
  const orders = await Order.find({ userId: req.session.sub }, { userId: 0, __v: 0 }).sort({ createdAt: -1 }).lean();
  res.json({ orders });
}));

function extractOrderCode(text) {
  if (!text || typeof text !== 'string') return null;
  const matchHC = text.match(/HC\d{6}/i);
  if (matchHC) return matchHC[0].toUpperCase();
  const matchObjId = text.match(/[a-f0-9]{24}/i);
  if (matchObjId) return matchObjId[0];
  return null;
}

router.post('/sepay-webhook', asyncRoute(async (req, res) => {
  console.log('[SePay Webhook Received]:', {
    authHeader: req.headers['authorization'],
    body: req.body,
  });

  const apiKey = process.env.SEPAY_WEBHOOK_API_KEY;
  if (apiKey && apiKey !== 'hachimi_sepay_secret_key') {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.includes(apiKey)) {
      console.warn('[SePay Webhook] Auth key mismatch:', { received: authHeader, expected: apiKey });
      return res.status(200).json({ success: false, message: 'Unauthorized webhook key' });
    }
  }

  const {
    id: transactionId,
    gateway,
    transferType,
    transferAmount,
    content,
    description,
    referenceCode,
    transactionDate,
  } = req.body || {};

  if (transferType && transferType !== 'in') {
    return res.json({ success: true, message: 'Ignored non-inward transaction' });
  }

  const searchText = `${content || ''} ${description || ''}`;
  const orderCode = extractOrderCode(searchText);

  if (!orderCode) {
    return res.json({ success: true, message: 'Test or sample transaction received (no order code)' });
  }

  let order = await Order.findOne({ code: orderCode, status: 'pending' });
  if (!order && orderCode.length === 24) {
    order = await Order.findOne({ _id: orderCode, status: 'pending' });
  }

  if (!order) {
    return res.json({ success: true, message: `No pending order matching code: ${orderCode}` });
  }

  const amount = Number(transferAmount || 0);
  if (amount < order.finalPrice) {
    return res.json({ success: false, message: `Transfer amount (${amount}) is less than required (${order.finalPrice})` });
  }

  order.status = 'active';
  order.activatedBy = 'sepay_webhook';
  order.paymentInfo = {
    transactionId: String(transactionId || ''),
    gateway: gateway || '',
    transferAmount: amount,
    referenceCode: referenceCode || '',
    transactionDate: transactionDate || new Date().toISOString(),
  };
  await order.save();

  await applyOrderBenefits(order);

  if (order.voucherCode) {
    await Voucher.updateOne({ code: order.voucherCode }, { $inc: { usedCount: 1 } });
  }

  res.json({ success: true, message: 'Order activated successfully', orderId: order._id });
}));

export default router;
