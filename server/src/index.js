import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { connectDB } from './db.js';
import { errorHandler, rateLimit } from './middleware.js';
import authRouter from './routes/auth.js';
import progressRouter from './routes/progress.js';
import questionsRouter from './routes/questions.js';
import subjectsRouter from './routes/subjects.js';
import adminRouter from './routes/admin.js';
import profileRouter from './routes/profile.js';
import commerceRouter from './routes/commerce.js';

const app = express();

// Render đứng sau proxy, cần bật để req.ip là IP thật của client chứ không phải
// của proxy - nếu không thì rate limit gộp chung mọi người vào một rổ.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5183',
    credentials: true,
  }),
);
app.use(cookieParser());

app.use('/api', rateLimit({ windowMs: 60_000, max: 240 }));
app.use(
  '/api/admin',
  express.json({ limit: '3mb' }),
  rateLimit({ windowMs: 60_000, max: 120, message: 'Thao tác quản trị quá nhanh, đợi một phút nhé.' }),
  adminRouter,
);
app.use(express.json({ limit: '64kb' }));
app.use(
  '/api/auth/google',
  rateLimit({ windowMs: 60_000, max: 12, message: 'Thử đăng nhập quá nhiều lần, đợi một phút nhé.' }),
);

app.use('/api/auth', authRouter);
app.use('/api/progress', progressRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/subjects', subjectsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/commerce', commerceRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(errorHandler);

// Lưới an toàn cuối cùng: ghi log thay vì để tiến trình tự thoát.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const port = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(port, () => console.log(`Server listening on port ${port}`));
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  });
