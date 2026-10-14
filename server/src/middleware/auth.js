import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(payload.sub).select('name email').lean();
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    return next();
  } catch { return res.status(401).json({ error: 'Session is invalid or expired. Please sign in again.' }); }
}
