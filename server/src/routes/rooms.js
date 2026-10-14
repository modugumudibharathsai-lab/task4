import { Router } from 'express';
import { z } from 'zod';
import Room from '../models/Room.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const roomIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/);
router.use(requireAuth);
router.post('/', async (req, res, next) => {
  try {
    const title = z.string().trim().max(120).optional().safeParse(req.body?.title);
    if (!title.success) return res.status(400).json({ error: 'Room title is too long.' });
    const roomId = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const room = await Room.create({ roomId, createdBy: req.user._id, title: title.data || 'Meeting room' });
    return res.status(201).json({ room: { roomId: room.roomId, title: room.title, createdAt: room.createdAt } });
  } catch (err) { return next(err); }
});
router.get('/:roomId', async (req, res, next) => {
  try {
    const parsed = roomIdSchema.safeParse(req.params.roomId);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid room code.' });
    const room = await Room.findOneAndUpdate({ roomId: parsed.data.toUpperCase() }, { $set: { lastActiveAt: new Date() } }, { new: true }).select('roomId title createdAt').lean();
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    return res.json({ room });
  } catch (err) { return next(err); }
});
export default router;
