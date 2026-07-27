// Express 4 không bắt lỗi của handler async: promise bị reject sẽ thành
// unhandledRejection và Node ≥15 kết thúc tiến trình. Bọc lại để một lỗi DB
// hay dữ liệu xấu chỉ hỏng một request thay vì hạ cả server.
export const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  // Lỗi do client gửi sai thì trả đúng mã, đừng gán thành 500.
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  }
  if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return res.status(400).json({ error: 'JSON không hợp lệ' });
  }
  if (error.name === 'CastError' || error.name === 'ValidationError') {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(500).json({ error: 'Server error' });
}

// Giới hạn số request theo IP, đủ để một người không nện sập dịch vụ free.
export function rateLimit({ windowMs, max, message = 'Quá nhiều yêu cầu, thử lại sau ít phút nhé.' }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Chuỗi do client gửi: đúng kiểu, không rỗng, không dài quá mức.
export const isSafeString = (value, maxLength) =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength;
