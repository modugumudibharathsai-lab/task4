import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Video, Mic, MicOff, VideoOff, MonitorUp, PhoneOff, MessageSquare, Users, PenTool, Paperclip, Copy, Shield, Plus, ArrowRight, X, Send, Camera, Circle, Eraser, Trash2, Link2, Check, Wifi, Sparkles, Square } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : window.location.origin);
const tokenKey = 'orbit_token';
const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...(import.meta.env.VITE_TURN_URL ? [{ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : [])] };

function App() {
  const [token, setToken] = useState(localStorage.getItem(tokenKey));
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const socketRef = useRef(null);
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [side, setSide] = useState('chat');
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const videoRefs = useRef(new Map());
  const peers = useRef(new Map());
  const streamRef = useRef(null);
  const shareRef = useRef(null);
  const canvasRef = useRef(null);
  const drawing = useRef(null);
  const incomingFiles = useRef(new Map());
  const pendingIce = useRef(new Map());
  const boardOperations = useRef([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#7c8cff');
  const [stroke, setStroke] = useState(3);

  useEffect(() => { if (token) fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { setUser(d.user); setDisplayName(d.user.name); }).catch(() => logout()); }, [token]);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    shareRef.current?.getTracks().forEach(t => t.stop());
    peers.current.forEach(p => p.close());
    socketRef.current?.disconnect();
  }, []);

  async function submitAuth(e) {
    e.preventDefault(); setAuthError('');
    if (auth.password.length < 8) return setAuthError('Use a password with at least 8 characters.');
    if (authMode === 'signup' && !auth.name.trim()) return setAuthError('Enter your name.');
    try {
      const response = await fetch(`${API}/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(auth) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not sign in.');
      localStorage.setItem(tokenKey, data.token); setUser(data.user); setDisplayName(data.user.name); setToken(data.token); setView('home');
    } catch (err) { setAuthError(err.message); }
  }
  function logout() { localStorage.removeItem(tokenKey); setToken(null); setUser(null); setView('home'); }

  async function enterRoom(id = roomInput.trim()) {
    if (!id) return;
    setMediaError(''); setRoomId(id.toUpperCase()); setView('meeting'); setChat([]); setParticipants([]);
    let stream = null;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } }); }
    catch (err) { setMediaError(err.name === 'NotAllowedError' ? 'Camera or microphone access was denied. You can still join to chat.' : 'Camera or microphone is unavailable. You can still join to chat.'); }
    streamRef.current = stream; setLocalStream(stream); setCamOn(Boolean(stream?.getVideoTracks().length)); setMicOn(Boolean(stream?.getAudioTracks().length));
    const s = io(API, { auth: { token: token || undefined }, transports: ['websocket', 'polling'] }); socketRef.current = s;
    s.on('connect', () => { s.emit('room:join', { roomId: id.toUpperCase(), name: displayName || user?.name || 'Guest' }); setConnected(true); });
    s.on('connect_error', err => setMediaError(err.message || 'Could not connect to the meeting server.'));
    s.on('room:peers', async list => { setParticipants(list); for (const person of list) await callPeer(person.id); });
    s.on('peer:joined', person => setParticipants(current => current.some(p => p.id === person.id) ? current : [...current, person]));
    s.on('peer:left', id2 => { peers.current.get(id2)?.close(); peers.current.delete(id2); setParticipants(current => current.filter(p => p.id !== id2)); });
    s.on('peer:screen', ({ id: peerId, sharing: peerSharing }) => setParticipants(current => current.map(person => person.id === peerId ? { ...person, sharing: peerSharing } : person)));
    s.on('signal', async ({ from, data }) => handleSignal(from, data));
    s.on('chat:message', item => setChat(current => [...current, item]));
    s.on('board:draw', data => drawRemote(data));
    s.on('board:clear', () => clearCanvas(false));
    s.on('board:history', history => {
      if (!Array.isArray(history)) return;
      boardOperations.current = history.filter(item => item && Number.isFinite(item.x0) && Number.isFinite(item.y0) && Number.isFinite(item.x1) && Number.isFinite(item.y1));
      redrawBoard();
    });
    s.on('room:error', e => setMediaError(e.message));
  }
  function attachFileChannel(channel, peerId) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onmessage = event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'file-start' && typeof packet.id === 'string' && typeof packet.name === 'string' && Number.isInteger(packet.count) && packet.count > 0 && packet.count <= 400) {
          incomingFiles.current.set(packet.id, { name: packet.name.slice(0, 180), owner: typeof packet.owner === 'string' ? packet.owner.slice(0, 60) : 'Guest', peerId, mime: typeof packet.mime === 'string' ? packet.mime.slice(0, 100) : 'application/octet-stream', count: packet.count, chunks: new Array(packet.count), received: 0 });
        } else if (packet.type === 'file-part' && typeof packet.id === 'string' && Number.isInteger(packet.i) && typeof packet.chunk === 'string') {
          const transfer = incomingFiles.current.get(packet.id);
          if (transfer && packet.i >= 0 && packet.i < transfer.count && !transfer.chunks[packet.i]) { transfer.chunks[packet.i] = packet.chunk; transfer.received++; }
        } else if (packet.type === 'file-end' && typeof packet.id === 'string') {
          const transfer = incomingFiles.current.get(packet.id);
          if (transfer && transfer.received === transfer.count) {
            const data = transfer.chunks.join('');
            const blob = new Blob([Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), ch => ch.charCodeAt(0))], { type: transfer.mime });
            setChat(current => [...current, { id: crypto.randomUUID(), name: transfer.owner || 'Guest', text: `Shared a file: ${transfer.name}`, file: URL.createObjectURL(blob), fileName: transfer.name, time: new Date().toISOString() }]);
            incomingFiles.current.delete(packet.id);
          }
        }
      } catch { setMediaError('A shared file could not be received.'); }
    };
    channel.onclose = () => incomingFiles.current.forEach((transfer, transferId) => { if (transfer.peerId === peerId) incomingFiles.current.delete(transferId); });
  }

  function makePeer(id, isOfferer = false) {
    const pc = new RTCPeerConnection(iceConfig);
    peers.current.set(id, pc);
    const localTracks = streamRef.current?.getTracks() || [];
    localTracks.forEach(track => pc.addTrack(track, streamRef.current));
    for (const kind of ['audio', 'video']) {
      if (!localTracks.some(track => track.kind === kind)) pc.addTransceiver(kind, { direction: 'sendrecv' });
    }
    if (shareRef.current?.getVideoTracks()[0]) {
      const videoSender = pc.getTransceivers().find(transceiver => transceiver.receiver.track.kind === 'video')?.sender;
      videoSender?.replaceTrack(shareRef.current.getVideoTracks()[0]).catch(() => setMediaError('Could not share your screen with a new participant.'));
    }
    pc.onicecandidate = e => { if (e.candidate) socketRef.current?.emit('signal', { to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = e => {
      const remoteStream = e.streams[0] || new MediaStream([e.track]);
      setParticipants(current => current.map(p => p.id === id ? { ...p, stream: remoteStream } : p));
    };
    pc.ondatachannel = event => {
      pc.fileChannel = event.channel;
      pc.fileQueue = Promise.resolve();
      attachFileChannel(event.channel, id);
    };
    if (isOfferer) {
      pc.fileChannel = pc.createDataChannel('room-files', { ordered: true });
      attachFileChannel(pc.fileChannel, id);
      pc.fileQueue = Promise.resolve();
    }
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) { peers.current.delete(id); setParticipants(current => current.map(p => p.id === id ? { ...p, stream: null } : p)); } };
    return pc;
  }
  async function callPeer(id) { if (peers.current.has(id)) return; const pc = makePeer(id, true); try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socketRef.current?.emit('signal', { to: id, data: { description: pc.localDescription } }); } catch { setMediaError('Could not establish a peer connection. Check your network or TURN settings.'); } }
  async function handleSignal(from, data) {
    let pc = peers.current.get(from); if (!pc) pc = makePeer(from);
    try {
      if (data.description) { await pc.setRemoteDescription(data.description); if (data.description.type === 'offer') { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socketRef.current?.emit('signal', { to: from, data: { description: pc.localDescription } }); } }
      else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingIce.current.set(from, [...(pendingIce.current.get(from) || []), data.candidate]);
      }
      if (data.description && pc.remoteDescription) {
        const queued = pendingIce.current.get(from) || [];
        pendingIce.current.delete(from);
        for (const candidate of queued) await pc.addIceCandidate(candidate);
      }
    } catch { setMediaError('A peer connection could not be negotiated. Try rejoining the room.'); }
  }
  function leaveRoom() { socketRef.current?.emit('room:leave'); socketRef.current?.disconnect(); socketRef.current = null; peers.current.forEach(p => p.close()); peers.current.clear(); pendingIce.current.clear(); streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; shareRef.current?.getTracks().forEach(t => t.stop()); shareRef.current = null; boardOperations.current = []; setLocalStream(null); setSharing(false); setParticipants([]); setConnected(false); setView('home'); }
  async function acquireTrack(kind) {
    const trackName = kind === 'audio' ? 'audio' : 'video';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ [trackName]: true });
      const track = fresh.getTracks().find(item => item.kind === kind);
      const current = streamRef.current || new MediaStream();
      for (const previous of current.getTracks().filter(item => item.kind === kind)) { current.removeTrack(previous); previous.stop(); }
      current.addTrack(track);
      streamRef.current = current;
      if (kind === 'video' && !sharing) {
        for (const pc of peers.current.values()) {
          const sender = pc.getTransceivers().find(item => item.receiver.track.kind === kind)?.sender;
          if (sender) await sender.replaceTrack(track);
        }
      } else if (kind === 'audio') {
        for (const pc of peers.current.values()) {
          const sender = pc.getTransceivers().find(item => item.receiver.track.kind === kind)?.sender;
          if (sender) await sender.replaceTrack(track);
        }
      }
      setLocalStream(new MediaStream(current.getTracks()));
      if (kind === 'audio') setMicOn(true); else setCamOn(true);
    } catch { setMediaError(`Could not access your ${kind === 'audio' ? 'microphone' : 'camera'}. Check the browser permission and device, then try again.`); }
  }
  async function toggleMic() { const track = streamRef.current?.getAudioTracks()[0]; if (!track || track.readyState === 'ended') return acquireTrack('audio'); const on = !micOn; track.enabled = on; setMicOn(on); }
  async function toggleCam() { const track = streamRef.current?.getVideoTracks()[0]; if (!track || track.readyState === 'ended') return acquireTrack('video'); const on = !camOn; track.enabled = on; setCamOn(on); }
  async function toggleShare() {
    if (sharing) { shareRef.current?.getTracks().forEach(t => t.stop()); shareRef.current = null; for (const pc of peers.current.values()) { const sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender; if (sender) await sender.replaceTrack(streamRef.current?.getVideoTracks()[0] || null); } socketRef.current?.emit('screen:sharing', { sharing: false }); setSharing(false); return; }
    try { const screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); const track = screen.getVideoTracks()[0]; shareRef.current = screen; for (const pc of peers.current.values()) { const sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender; if (sender) await sender.replaceTrack(track); } track.onended = () => { if (shareRef.current) toggleShare(); }; socketRef.current?.emit('screen:sharing', { sharing: true }); setSharing(true); }
    catch (err) { if (err.name !== 'NotAllowedError') setMediaError('Screen sharing could not start.'); }
  }
  async function switchCamera() {
    try { const current = streamRef.current; if (!current) throw new Error('Camera is not available.'); const old = current.getVideoTracks()[0]; const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: old?.getSettings().facingMode === 'environment' ? 'user' : 'environment' } }); const track = fresh.getVideoTracks()[0]; if (old) current.removeTrack(old); old?.stop(); current.addTrack(track); if (!sharing) { for (const pc of peers.current.values()) { const sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender; if (sender) await sender.replaceTrack(track); } } setLocalStream(new MediaStream(current.getTracks())); setCamOn(true); } catch { setMediaError('Could not switch camera on this device.'); }
  }
  function sendMessage(e) { e.preventDefault(); const text = message.trim(); if (!text || !socketRef.current?.connected) return; socketRef.current.emit('chat:message', { text }); setMessage(''); }
  function copyInvite() { navigator.clipboard?.writeText(`${location.origin}/?room=${roomId}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }
  async function transmitFile(channel, file, data, id) {
    if (!channel) throw new Error('File sharing is not available for a participant yet. Rejoin the room and try again.');
    if (channel.readyState !== 'open') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('File transfer connection timed out.')), 20000);
        channel.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        channel.addEventListener('close', () => { clearTimeout(timeout); reject(new Error('The file transfer connection closed.')); }, { once: true });
      });
    }
    const chunks = data.match(/.{1,48000}/gs) || [];
    channel.send(JSON.stringify({ type: 'file-start', id, owner: displayName || user?.name || 'Guest', name: file.name, mime: file.type, count: chunks.length }));
    for (let i = 0; i < chunks.length; i++) {
      while (channel.bufferedAmount > 512 * 1024 && channel.readyState === 'open') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('File transfer stalled.')), 20000);
          const resume = () => { clearTimeout(timeout); resolve(); };
          channel.addEventListener('bufferedamountlow', resume, { once: true });
          if (channel.bufferedAmount <= 512 * 1024) resume();
        });
      }
      if (channel.readyState !== 'open') throw new Error('The file transfer connection closed.');
      channel.send(JSON.stringify({ type: 'file-part', id, i, chunk: chunks[i] }));
    }
    channel.send(JSON.stringify({ type: 'file-end', id }));
  }

  function uploadFile(file) {
    if (!file || file.size > 12 * 1024 * 1024) { setMediaError('Files must be smaller than 12 MB.'); return; }
    if (peers.current.size === 0) { setMediaError('A peer must be connected before you can share a file.'); return; }
    const reader = new FileReader();
    reader.onerror = () => setMediaError('Could not read that file. Please try another file.');
    reader.onload = () => {
      const data = String(reader.result);
      const id = crypto.randomUUID();
      peers.current.forEach(pc => {
        const queue = pc.fileQueue || Promise.resolve();
        pc.fileQueue = queue.then(() => transmitFile(pc.fileChannel, file, data, id)).catch(error => setMediaError(error.message || ('Could not send ' + file.name + ' to a participant.')));
      });
      setChat(current => [...current, { id: crypto.randomUUID(), name: displayName || user?.name || 'You', text: 'Shared a file: ' + file.name, file: data, fileName: file.name, fileType: file.type, time: new Date().toISOString() }]);
    };
    reader.readAsDataURL(file);
  }

  function paintBoardOperation(data) { const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d'); ctx.strokeStyle = data.tool === 'eraser' ? '#101521' : data.color; ctx.lineWidth = data.width; ctx.lineCap = 'round'; const x0=data.x0*c.width, y0=data.y0*c.height, x1=data.x1*c.width, y1=data.y1*c.height; ctx.beginPath(); if (data.tool === 'rect') ctx.rect(x0,y0,x1-x0,y1-y0); else if (data.tool === 'circle') ctx.ellipse((x0+x1)/2,(y0+y1)/2,Math.abs(x1-x0)/2,Math.abs(y1-y0)/2,0,0,Math.PI*2); else { ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); } ctx.stroke(); }
  function drawRemote(data) { boardOperations.current.push(data); if (boardOperations.current.length > 5000) boardOperations.current.shift(); paintBoardOperation(data); }
  function redrawBoard() { const c=canvasRef.current; if (!c) return; c.getContext('2d').clearRect(0,0,c.width,c.height); for (const operation of boardOperations.current) paintBoardOperation(operation); }
  function drawStart(e) { const c = canvasRef.current; if (!c) return; c.setPointerCapture(e.pointerId); drawing.current = { x: e.nativeEvent.offsetX / c.clientWidth, y: e.nativeEvent.offsetY / c.clientHeight }; if (tool === 'rect' || tool === 'circle') drawing.current.tool = tool; }
  function drawMove(e) { if (!drawing.current) return; const c = canvasRef.current; const data = { x0: drawing.current.x, y0: drawing.current.y, x1: e.nativeEvent.offsetX / c.clientWidth, y1: e.nativeEvent.offsetY / c.clientHeight, color, width: stroke, tool }; if (tool === 'pen' || tool === 'eraser') { drawRemote(data); socketRef.current?.emit('board:draw', data); drawing.current = { ...drawing.current, x: data.x1, y: data.y1 }; } }
  function drawEnd(e) { if (!drawing.current) return; if (drawing.current.tool) { const c = canvasRef.current; const data = { x0: drawing.current.x, y0: drawing.current.y, x1: e.nativeEvent.offsetX / c.clientWidth, y1: e.nativeEvent.offsetY / c.clientHeight, color, width: stroke, tool: drawing.current.tool }; drawRemote(data); socketRef.current?.emit('board:draw', data); } drawing.current = null; }
  function clearCanvas(emit = true) { boardOperations.current = []; const c = canvasRef.current; c?.getContext('2d').clearRect(0, 0, c.width, c.height); if (emit) socketRef.current?.emit('board:clear'); }

  useEffect(() => { if (view !== 'meeting' || side !== 'board') return; const c = canvasRef.current; if (!c) return; const resize = () => { const rect = c.getBoundingClientRect(); c.width = rect.width; c.height = rect.height; redrawBoard(); }; resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [view, side]);
  useEffect(() => { if (view === 'home') { const id = new URLSearchParams(location.search).get('room'); if (id) setRoomInput(id); } }, [view]);

  const previewVideo = (stream, muted = false) => { const ref = node => { if (node && node.srcObject !== stream) node.srcObject = stream; }; return <video ref={ref} autoPlay playsInline muted={muted} />; };
  const chatText = item => <div className="msg-body">{item.text}{item.file && <a className="file-link" href={item.file} download={item.fileName}><Paperclip size={14} /> Download {item.fileName}</a>}</div>;
  if (view === 'auth') return <div className="auth-page"><div className="auth-art"><div className="auth-orbit"><span /><span /><span /><div className="auth-core"><Video size={30}/></div></div><p>Work feels closer,<br/>wherever you are.</p><small>A little more human, a lot more together.</small></div><div className="auth-side"><button className="brand auth-brand" onClick={() => setView('home')}><span className="brand-mark"><Video size={18}/></span>orbit</button><form className="auth-form" onSubmit={submitAuth}><div className="eyebrow">YOUR SPACE TO CONNECT</div><h1>{authMode === 'login' ? 'Welcome back' : 'Join the conversation'}</h1><p className="muted">{authMode === 'login' ? 'Sign in to get back to your meetings.' : 'Create an account and bring your team closer.'}</p>{authMode === 'signup' && <label>Your name<input required minLength="2" autoComplete="name" value={auth.name} onChange={e => setAuth({...auth, name: e.target.value})} placeholder="Alex Morgan"/></label>}<label>Email address<input required type="email" autoComplete="email" value={auth.email} onChange={e => setAuth({...auth, email: e.target.value})} placeholder="you@company.com"/></label><label>Password<input required type="password" minLength="8" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={auth.password} onChange={e => setAuth({...auth, password: e.target.value})} placeholder="At least 8 characters"/></label>{authError && <div className="error-text">{authError}</div>}<button className="primary wide">{authMode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={17}/></button><div className="auth-switch">{authMode === 'login' ? 'New to Orbit?' : 'Already have an account?'} <button type="button" onClick={() => {setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError('');}}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></div></form><div className="auth-foot"><Shield size={14}/> Your conversations stay private.</div></div></div>;

  if (view === 'meeting') return <div className="meeting-shell"><header className="meeting-top"><button className="brand" onClick={leaveRoom}><span className="brand-mark"><Video size={17}/></span>orbit</button><div className="meeting-meta"><span className={`live-dot ${connected ? '' : 'offline'}`} />{connected ? 'Live room' : 'Connecting'}<span className="dot-sep">·</span><span className="room-code">{roomId}</span><button className="icon-button subtle" onClick={copyInvite} title="Copy invite link">{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : 'Invite'}</span></button></div><div className="header-right"><span className="secure-tag"><Shield size={13}/>Private</span><div className="avatar small-avatar">{(displayName || 'G')[0].toUpperCase()}</div></div></header>
    {mediaError && <div className="meeting-alert">{mediaError}<button onClick={() => setMediaError('')}><X size={15}/></button></div>}
    <main className="meeting-main"><section className={`stage ${side !== 'none' ? 'with-panel' : ''}`}>{side === 'board' ? <div className="board-stage"><div className="board-head"><div><span className="eyebrow">COLLABORATIVE CANVAS</span><h2>Shared whiteboard</h2></div><div className="board-tools"><button className={tool === 'pen' ? 'tool-active' : ''} onClick={() => setTool('pen')} title="Pencil"><PenTool size={16}/></button><button className={tool === 'eraser' ? 'tool-active' : ''} onClick={() => setTool('eraser')} title="Eraser"><Eraser size={16}/></button><button className={tool === 'rect' ? 'tool-active' : ''} onClick={() => setTool('rect')} title="Rectangle"><Square size={16}/></button><button className={tool === 'circle' ? 'tool-active' : ''} onClick={() => setTool('circle')} title="Ellipse"><Circle size={16}/></button><label className="color-label" title="Stroke color"><input type="color" value={color} onChange={e => setColor(e.target.value)}/></label><input aria-label="Stroke width" type="range" min="1" max="16" value={stroke} onChange={e => setStroke(+e.target.value)}/><button onClick={() => clearCanvas()} title="Clear board"><Trash2 size={16}/></button></div></div><canvas ref={canvasRef} onPointerDown={drawStart} onPointerMove={drawMove} onPointerUp={drawEnd} onPointerCancel={drawEnd}/></div> : <div className={`video-grid count-${Math.min(participants.length + 1, 9)}`}><div className={`video-tile self-tile ${sharing ? 'featured' : ''}`}>{sharing ? previewVideo(shareRef.current, true) : localStream ? previewVideo(localStream, true) : <div className="camera-off"><VideoOff size={25}/></div>}<div className="tile-info"><span className="tile-avatar">{(displayName || user?.name || 'Y')[0]?.toUpperCase()}</span><span>{displayName || user?.name || 'You'}{!micOn && ' · muted'}</span><span className="tile-you">You</span></div></div>{participants.map((p, i) => <div className={`video-tile ${p.sharing ? 'featured' : ''}`} key={p.id}>{p.stream ? previewVideo(p.stream) : <div className={`participant-placeholder hue-${i % 6}`}><span>{p.name?.slice(0,1)?.toUpperCase() || 'G'}</span><small>Connecting…</small></div>}<div className="tile-info"><span className="tile-avatar remote">{p.name?.slice(0,1)?.toUpperCase() || 'G'}</span><span>{p.name || 'Guest'}{p.sharing ? ' · sharing screen' : ''}</span></div></div>)}{participants.length === 0 && <div className="waiting-card"><div className="waiting-icon"><Users size={21}/></div><strong>Your room is ready</strong><span>Invite someone to start the conversation.</span><button className="outline small" onClick={copyInvite}><Link2 size={15}/> Copy invite link</button></div>}</div>}</section>
    {side !== 'none' && <aside className="side-panel"><div className="panel-head"><div><span className="eyebrow">{side === 'chat' ? 'ROOM CONVERSATION' : side === 'people' ? 'IN THIS ROOM' : 'ROOM FILES'}</span><h3>{side === 'chat' ? 'Messages' : side === 'people' ? `People (${participants.length + 1})` : 'Shared files'}</h3></div><button className="icon-button" onClick={() => setSide('none')}><X size={17}/></button></div>{side === 'chat' ? <><div className="messages-list">{chat.length === 0 && <div className="empty-chat"><div className="empty-chat-icon"><MessageSquare size={21}/></div><strong>Say hello</strong><span>Messages sent here are visible to everyone in the room.</span></div>}{chat.map(item => <div className="message-row" key={item.id}><div className="avatar msg-avatar">{(item.name || 'G')[0].toUpperCase()}</div><div className="msg-content"><div className="msg-meta"><strong>{item.name}</strong><time>{new Date(item.time).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time></div>{chatText(item)}</div></div>)}</div><form className="composer" onSubmit={sendMessage}><label className="attach-button" title="Share file"><Paperclip size={17}/><input type="file" hidden onChange={e => {uploadFile(e.target.files?.[0]); e.target.value = '';}}/></label><input value={message} onChange={e => setMessage(e.target.value)} placeholder="Message everyone…" maxLength={2000}/><button disabled={!message.trim()}><Send size={16}/></button></form></> : side === 'people' ? <div className="people-list"><div className="person-row"><div className="avatar">{(displayName || 'Y')[0]?.toUpperCase()}</div><div><strong>{displayName || 'You'}</strong><span>You · Host</span></div><span className="mic-status">{micOn ? <Mic size={14}/> : <MicOff size={14}/>}</span></div>{participants.map(p => <div className="person-row" key={p.id}><div className="avatar remote">{(p.name || 'G')[0]?.toUpperCase()}</div><div><strong>{p.name}</strong><span>In this meeting</span></div></div>)}</div> : <div className="messages-list">{chat.filter(c => c.file).map(item => <div className="file-card"><Paperclip size={17}/><span>{item.fileName}</span><a href={item.file} download={item.fileName}><ArrowRight size={15}/></a></div>)}{chat.filter(c => c.file).length === 0 && <div className="empty-chat"><div className="empty-chat-icon"><Paperclip size={20}/></div><strong>No files yet</strong><span>Share documents with everyone in your meeting.</span><label className="outline small file-pick">Share a file<input type="file" hidden onChange={e => {uploadFile(e.target.files?.[0]); e.target.value='';}}/></label></div>}</div>}</aside>}</main>
    <footer className="control-bar"><div className="control-left"><span className="meeting-clock"><span className="live-dot"/>{new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</span><span className="control-divider"/><span className="participant-count"><Users size={15}/>{participants.length + 1}</span></div><div className="controls"><button className={`control-btn ${!micOn ? 'control-off' : ''}`} onClick={toggleMic} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>{micOn ? <Mic size={19}/> : <MicOff size={19}/>}<span>{micOn ? 'Mute' : 'Unmute'}</span></button><button className={`control-btn ${!camOn ? 'control-off' : ''}`} onClick={toggleCam} title="Toggle camera">{camOn ? <Video size={19}/> : <VideoOff size={19}/>}<span>{camOn ? 'Camera' : 'Start video'}</span></button><button className="control-btn camera-switch" onClick={switchCamera} title="Switch camera"><Camera size={18}/><span>Flip</span></button><button className={`control-btn share-control ${sharing ? 'selected' : ''}`} onClick={toggleShare} title="Share screen"><MonitorUp size={19}/><span>{sharing ? 'Stop share' : 'Share'}</span></button><button className={`control-btn ${side === 'board' ? 'selected' : ''}`} onClick={() => setSide(side === 'board' ? 'none' : 'board')} title="Whiteboard"><PenTool size={19}/><span>Board</span></button><button className="leave-btn" onClick={leaveRoom} title="Leave meeting"><PhoneOff size={19}/><span>Leave</span></button></div><div className="control-right"><button className={`panel-toggle ${side === 'chat' ? 'selected' : ''}`} onClick={() => setSide(side === 'chat' ? 'none' : 'chat')} title="Chat"><MessageSquare size={18}/><span>Chat</span>{chat.length > 0 && <i/>}</button><button className={`panel-toggle ${side === 'people' ? 'selected' : ''}`} onClick={() => setSide(side === 'people' ? 'none' : 'people')} title="People"><Users size={18}/><span>People</span></button><button className={`panel-toggle ${side === 'files' ? 'selected' : ''}`} onClick={() => setSide(side === 'files' ? 'none' : 'files')} title="Files"><Paperclip size={18}/><span>Files</span></button></div></footer>
  </div>;

  return <div className="home-page"><header className="home-nav"><button className="brand" onClick={() => setView('home')}><span className="brand-mark"><Video size={17}/></span>orbit</button><nav><a href="#features">Why Orbit</a><a href="#how">How it works</a></nav><div className="nav-actions">{user ? <><span className="welcome-name">Hi, {user.name.split(' ')[0]}</span><button className="avatar" title="Sign out" onClick={logout}>{user.name[0].toUpperCase()}</button></> : <button className="nav-login" onClick={() => {setAuthMode('login');setView('auth');}}>Sign in</button>}<button className="primary nav-cta" onClick={() => user ? enterRoom(crypto.randomUUID().slice(0,8).toUpperCase()) : (setAuthMode('signup'),setView('auth'))}><Plus size={16}/>Start a meeting</button></div></header>
    <main><section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/>A better way to meet</div><h1>Good things happen<br/>when we <span className="gradient-word">get together.</span></h1><p>Make space for real conversations. Orbit brings your people, ideas and moments into one place — wherever you are.</p><div className="hero-actions"><button className="primary hero-primary" onClick={() => user ? enterRoom(crypto.randomUUID().slice(0,8).toUpperCase()) : (setAuthMode('signup'),setView('auth'))}>Start a new meeting<ArrowRight size={17}/></button><div className="join-wrap"><span className="join-label">or join with a code</span><form className="join-form" onSubmit={e => {e.preventDefault();user ? enterRoom() : (setAuthMode('login'),setView('auth'));}}><Link2 size={16}/><input value={roomInput} onChange={e => setRoomInput(e.target.value.toUpperCase())} placeholder="Enter meeting code" maxLength={40}/><button title="Join meeting"><ArrowRight size={16}/></button></form></div></div><div className="hero-trust"><div className="trust-avatars"><span>A</span><span>M</span><span>J</span><span><Plus size={11}/></span></div><span>Little moments, better together.</span><span className="trust-lock"><Shield size={14}/>Private by design</span></div></div><div className="hero-visual"><div className="visual-glow"/><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="meeting-card"><div className="card-head"><div><span className="card-live"><i/>LIVE MEETING</span><strong>Monday catch-up</strong></div><div className="card-dots"><i/><i/><i/></div></div><div className="mock-video-grid"><div className="mock-person person-1"><div className="mock-person-bg"><span className="person-shape">M</span></div><div className="mock-label"><i/>Maya Chen</div></div><div className="mock-person person-2"><div className="mock-person-bg"><span className="person-shape">J</span></div><div className="mock-label"><i/>Jordan Lee</div></div><div className="mock-person person-3"><div className="mock-person-bg"><span className="person-shape">A</span></div><div className="mock-label"><i/>Alex Rivera</div></div><div className="mock-person person-4"><div className="mock-person-bg"><span className="person-shape">S</span></div><div className="mock-label"><i/>Sam Taylor</div></div></div><div className="mock-toolbar"><div className="mock-tools"><span><Mic size={13}/></span><span><Video size={13}/></span><span><MonitorUp size={13}/></span></div><span className="mock-call"><PhoneOff size={13}/></span><div className="mock-tools"><span><MessageSquare size={13}/></span><span><Users size={13}/></span></div></div></div><div className="float-note note-1"><span className="note-icon"><Sparkles size={15}/></span><div><strong>You're all here!</strong><small>4 people in the room</small></div><span className="note-dot"/></div><div className="float-note note-2"><span className="note-check"><Check size={13}/></span><span>Crystal-clear connection</span></div><div className="visual-caption"><span className="caption-dot"/> A seat at the table, from anywhere</div></div></section>
    <section id="features" className="feature-strip"><div className="feature-item"><span className="feature-icon violet"><Video size={18}/></span><div><strong>Face-to-face, anywhere</strong><span>Clear video that feels close</span></div></div><div className="feature-item"><span className="feature-icon aqua"><PenTool size={18}/></span><div><strong>Think out loud, together</strong><span>A shared canvas for big ideas</span></div></div><div className="feature-item"><span className="feature-icon rose"><MessageSquare size={18}/></span><div><strong>Keep the conversation going</strong><span>Chat and share as you go</span></div></div><div className="feature-item"><span className="feature-icon gold"><Shield size={18}/></span><div><strong>Your space stays yours</strong><span>Private rooms, secure sign-in</span></div></div></section>
    <section id="how" className="how-section"><div className="how-intro"><span className="eyebrow"><span className="eyebrow-line"/>SIMPLE BY DESIGN</span><h2>From hello to<br/><span className="gradient-word">here together.</span></h2><p>Skip the setup and get to the good part. Your next great conversation is just a room away.</p></div><div className="steps"><article><span className="step-num">01</span><span className="step-icon"><Plus size={19}/></span><h3>Make a little space</h3><p>Start a meeting in one click. Your private room is ready whenever you are.</p></article><article><span className="step-num">02</span><span className="step-icon"><Link2 size={19}/></span><h3>Bring your people in</h3><p>Share your invite link and let everyone find their way to the table.</p></article><article><span className="step-num">03</span><span className="step-icon"><Sparkles size={19}/></span><h3>Make something happen</h3><p>Talk, sketch, share and create those moments that move things forward.</p></article></div></section>
    <section className="bottom-cta"><div className="cta-orb"><Video size={23}/></div><div><h2>Good conversations start somewhere.</h2><p>Make today the day you get everyone together.</p></div><button className="primary" onClick={() => user ? enterRoom(crypto.randomUUID().slice(0,8).toUpperCase()) : (setAuthMode('signup'),setView('auth'))}>Let's meet<ArrowRight size={16}/></button></section></main><footer className="home-footer"><button className="brand" onClick={() => window.scrollTo({top:0,behavior:'smooth'})}><span className="brand-mark"><Video size={15}/></span>orbit</button><span>Made for the moments that matter.</span><span>© 2025 Orbit Meetings</span></footer></div>;
}
export default App;
