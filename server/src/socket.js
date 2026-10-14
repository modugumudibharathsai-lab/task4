import jwt from 'jsonwebtoken';
import { z } from 'zod';
import User from './models/User.js';
import Room from './models/Room.js';

const roomSchema = z.string().regex(/^[A-Z0-9_-]{3,40}$/);
const textSchema = z.string().trim().min(1).max(2000);
const safeName = z.string().trim().min(1).max(60).transform(s => s.replace(/[<>]/g, ''));
const roomBoards = new Map();

export function configureSockets(io) {
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token;
      if (!raw) { socket.data.user = null; return next(); }
      const claims = jwt.verify(raw, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'orbit-meet', audience: 'orbit-client' });
      const user = await User.findById(claims.sub).select('name email').lean();
      if (!user) return next(new Error('Account not found.'));
      socket.data.user = { id: user._id.toString(), name: user.name };
      return next();
    } catch { return next(new Error('Invalid or expired session.')); }
  });

  io.on('connection', socket => {
    let activeRoom = null;
    let displayName = socket.data.user?.name || 'Guest';

    socket.on('room:join', async (payload, ack) => {
      const parsedRoom = roomSchema.safeParse(payload?.roomId?.toUpperCase?.());
      const parsedName = safeName.safeParse(payload?.name);
      if (!parsedRoom.success || !parsedName.success) { socket.emit('room:error', { message: 'Use a valid room code and display name.' }); return; }
      try {
        const roomId = parsedRoom.data;
        await Room.updateOne({ roomId }, { $setOnInsert: { roomId, createdBy: socket.data.user?.id || null, title: 'Meeting room' }, $set: { lastActiveAt: new Date() } }, { upsert: true });
        if (activeRoom && activeRoom !== roomId) {
          const previousRoom = activeRoom;
          await socket.leave(previousRoom);
          socket.to(previousRoom).emit('peer:left', socket.id);
          if (!io.sockets.adapter.rooms.get(previousRoom)?.size) roomBoards.delete(previousRoom);
        }
        activeRoom = roomId; displayName = socket.data.user?.name || parsedName.data;
        const peers = [...(io.sockets.adapter.rooms.get(roomId) || [])].filter(id => id !== socket.id).map(id => ({ id, name: io.sockets.sockets.get(id)?.data.displayName || 'Guest', sharing: Boolean(io.sockets.sockets.get(id)?.data.screenSharing) }));
        socket.join(roomId); socket.data.displayName = displayName;
        socket.emit('room:peers', peers);
        socket.emit('board:history', roomBoards.get(roomId) || []);
        socket.to(roomId).emit('peer:joined', { id: socket.id, name: displayName });
        ack?.({ ok: true, peers });
      } catch { socket.emit('room:error', { message: 'Unable to join this room right now.' }); }
    });

    socket.on('signal', payload => {
      if (!activeRoom || typeof payload?.to !== 'string' || payload.to.length > 64 || !payload?.data || typeof payload.data !== 'object') return;
      if (JSON.stringify(payload.data).length > 100_000) return;
      if (!io.sockets.adapter.rooms.get(activeRoom)?.has(payload.to)) return;
      io.to(payload.to).emit('signal', { from: socket.id, data: payload.data });
    });
    socket.on('chat:message', payload => {
      if (!activeRoom) return;
      const parsed = textSchema.safeParse(payload?.text);
      if (!parsed.success) return;
      io.to(activeRoom).emit('chat:message', { id: crypto.randomUUID(), name: displayName, text: parsed.data, time: new Date().toISOString() });
    });
    socket.on('board:draw', payload => {
      if (!activeRoom || !payload || typeof payload !== 'object') return;
      const point = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
      if (![payload.x0,payload.y0,payload.x1,payload.y1].every(point) || !Number.isFinite(payload.width) || payload.width < 1 || payload.width > 20 || !/^#[\da-fA-F]{6}$/.test(payload.color || '') || !['pen','eraser','rect','circle'].includes(payload.tool)) return;
      const stroke = { x0:payload.x0,y0:payload.y0,x1:payload.x1,y1:payload.y1,width:payload.width,color:payload.color,tool:payload.tool };
      const history = roomBoards.get(activeRoom) || [];
      history.push(stroke);
      if (history.length > 5000) history.splice(0, history.length - 5000);
      roomBoards.set(activeRoom, history);
      socket.to(activeRoom).emit('board:draw', stroke);
    });
    socket.on('board:clear', () => { if (activeRoom) { roomBoards.set(activeRoom, []); socket.to(activeRoom).emit('board:clear'); } });
    socket.on('room:leave', async () => {
      if (!activeRoom) return;
      const roomId = activeRoom;
      activeRoom = null;
      await socket.leave(roomId);
      socket.to(roomId).emit('peer:left', socket.id);
      if (!io.sockets.adapter.rooms.get(roomId)?.size) roomBoards.delete(roomId);
    });
    socket.on('screen:sharing', payload => {
      if (!activeRoom || typeof payload?.sharing !== 'boolean') return;
      socket.data.screenSharing = payload.sharing;
      socket.to(activeRoom).emit('peer:screen', { id: socket.id, sharing: payload.sharing });
    });
    socket.on('disconnect', () => {
      if (!activeRoom) return;
      const roomId = activeRoom;
      socket.to(roomId).emit('peer:left', socket.id);
      if (!io.sockets.adapter.rooms.get(roomId)?.size) roomBoards.delete(roomId);
    });
  });
}
