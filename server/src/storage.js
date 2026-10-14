import mongoose from 'mongoose';
import User from './models/User.js';
import Room from './models/Room.js';

const memoryUsersById = new Map();
const memoryUserIdsByEmail = new Map();
const memoryRoomsById = new Map();
let useMemoryStore = false;

export async function connectStorage() {
  useMemoryStore = process.env.NODE_ENV !== 'production' && process.env.DEV_MEMORY_STORE === 'true';
  if (useMemoryStore) {
    console.warn('Development memory store enabled. User accounts and room metadata reset when the server restarts.');
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
}

export async function findUserByEmail(email, includePassword = false) {
  if (useMemoryStore) {
    const id = memoryUserIdsByEmail.get(email);
    const user = id ? memoryUsersById.get(id) : null;
    if (!user) return null;
    if (includePassword) return user;
    return { _id: user._id, name: user.name, email: user.email };
  }
  const query = User.findOne({ email });
  if (includePassword) query.select('+passwordHash');
  return query;
}

export async function createUser(data) {
  if (useMemoryStore) {
    if (memoryUserIdsByEmail.has(data.email)) {
      const error = new Error('An account with that email already exists.');
      error.code = 11000;
      throw error;
    }
    const user = { _id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
    memoryUsersById.set(user._id, user);
    memoryUserIdsByEmail.set(user.email, user._id);
    return user;
  }
  return User.create(data);
}

export async function findUserById(id) {
  if (useMemoryStore) return memoryUsersById.get(String(id)) || null;
  return User.findById(id).select('name email').lean();
}

export async function createRoom(data) {
  if (useMemoryStore) {
    const room = { ...data, createdAt: new Date(), lastActiveAt: new Date() };
    memoryRoomsById.set(room.roomId, room);
    return room;
  }
  return Room.create(data);
}

export async function touchRoom(roomId) {
  if (useMemoryStore) {
    const room = memoryRoomsById.get(roomId);
    if (!room) return null;
    room.lastActiveAt = new Date();
    return { roomId: room.roomId, title: room.title, createdAt: room.createdAt };
  }
  return Room.findOneAndUpdate({ roomId }, { $set: { lastActiveAt: new Date() } }, { new: true }).select('roomId title createdAt').lean();
}

export async function touchOrCreateSocketRoom(roomId, createdBy) {
  if (useMemoryStore) {
    const room = memoryRoomsById.get(roomId);
    if (room) room.lastActiveAt = new Date();
    else memoryRoomsById.set(roomId, { roomId, createdBy, title: 'Meeting room', createdAt: new Date(), lastActiveAt: new Date() });
    return;
  }
  await Room.updateOne({ roomId }, { $setOnInsert: { roomId, createdBy, title: 'Meeting room' }, $set: { lastActiveAt: new Date() } }, { upsert: true });
}
