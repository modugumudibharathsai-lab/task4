import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { createUser, findUserByEmail } from '../storage.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const password = z.string().min(8).max(72);
const profile = user => ({ id: user._id.toString(), name: user.name, email: user.email });
const issue = user => jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '1d', issuer: 'orbit-meet', audience: 'orbit-client' });

router.post('/signup', async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(2).max(60), email, password }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 8 characters.' });
    const data = parsed.data;
    if (await findUserByEmail(data.email)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await createUser({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12) });
    return res.status(201).json({ token: issue(user), user: profile(user) });
  } catch (err) { if (err?.code === 11000) return res.status(409).json({ error: 'An account with that email already exists.' }); return next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = z.object({ email, password }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = await findUserByEmail(parsed.data.email, true);
    if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    return res.json({ token: issue(user), user: profile(user) });
  } catch (err) { return next(err); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: { id: req.user._id.toString(), name: req.user.name, email: req.user.email } }));
export default router;
