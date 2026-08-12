import { User } from './models/User.js';
import { requireAuth } from './auth.js';

export const ADMIN_EMAILS = new Set([
  'tranxuanthuan20@gmail.com',
  'ngochoang.le73@gmail.com',
]);

export const isAdminEmail = (email) =>
  typeof email === 'string' && ADMIN_EMAILS.has(email.trim().toLowerCase());

export function requireAdmin() {
  const authenticated = requireAuth();
  return [
    authenticated,
    async (req, res, next) => {
      try {
        const user = await User.findById(req.session.sub, { email: 1 }).lean();
        if (!user || !isAdminEmail(user.email)) {
          return res.status(403).json({ error: 'Chỉ tài khoản admin mới có quyền này' });
        }
        req.adminEmail = user.email.trim().toLowerCase();
        next();
      } catch (error) {
        next(error);
      }
    },
  ];
}
