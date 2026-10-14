import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import { configureSockets } from './socket.js';

const required = ['JWT_SECRET', 'MONGODB_URI'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} must be set in server/.env`);
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long.');
const app = express();
const server = http.createServer(app);
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
const io = new Server(server, { cors: { origin: origins, methods: ['GET','POST'], credentials: false }, maxHttpBufferSize: 1e6, pingTimeout: 20000 });

app.disable('x-powered-by');
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin(origin, cb) { if (!origin || origins.includes(origin)) return cb(null, true); return cb(new Error('Origin is not allowed by CORS.')); }, methods: ['GET','POST'], allowedHeaders: ['Content-Type','Authorization'], maxAge: 600 }));
app.use(express.json({ limit: '32kb', strict: true }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false }), authRoutes);
app.use('/api/rooms', roomRoutes);
app.use((err, _req, res, _next) => { if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must contain valid JSON.' }); if (err?.message?.includes('CORS')) return res.status(403).json({ error: 'Origin is not allowed.' }); console.error('Request failed:', err?.message || err); return res.status(500).json({ error: 'An unexpected server error occurred.' }); });
configureSockets(io);

const shutdown = async signal => { console.log(`Received ${signal}; closing server.`); io.close(); await mongoose.disconnect(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
const port = Number(process.env.PORT || 4000);
server.listen(port, () => console.log(`Orbit API and signaling listening on port ${port}`));
