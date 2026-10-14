import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  title: { type: String, trim: true, maxlength: 120, default: 'Meeting room' },
  lastActiveAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

export default mongoose.model('Room', roomSchema);
