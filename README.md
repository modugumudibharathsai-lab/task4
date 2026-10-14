# Orbit — Video meetings and real-time collaboration

## Project structure

```text
client/
  src/App.jsx          React screens, room controls, WebRTC mesh and whiteboard
  src/styles.css       Responsive application styles
  src/main.jsx         Browser entry point
  index.html
  vite.config.js
server/
  server.js            Production entry point
  src/index.js         Express API, Mongo connection, HTTP and Socket.IO setup
  src/socket.js        Room membership, WebRTC signaling, chat and board events
  src/middleware/      JWT authentication
  src/models/          Mongoose User and Room models
  src/routes/          Authentication and room API
  .env.example
package.json           Workspace commands
```

## Requirements

- Node.js 20 or newer and npm
- MongoDB, local or hosted
- Camera and microphone permissions; browsers require HTTPS for these APIs except on localhost

## Run locally

1. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI` and a unique random `JWT_SECRET` of at least 32 characters. Keep `.env` out of source control.
2. From the repository root, run `npm install`.
3. Run both apps with `npm run dev`.
4. Open `http://localhost:5173`, create an account, and start a meeting. Share the meeting code or invite link to join from another browser or device.

The client defaults to `http://localhost:4000` for the API and signaling server. Set `VITE_API_URL` in `client/.env.local` if the server is hosted elsewhere. Set `CLIENT_ORIGIN` on the server to the exact allowed client origin; comma-separate origins when needed. The API defaults to port 4000.

## TURN and deployment

The client uses Google's public STUN service by default. STUN alone cannot connect every NAT/firewall combination. For reliable cross-network calls, provision a TURN service and configure `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` in the client environment. Do not commit TURN credentials. Use a short-lived credential service for public production deployments rather than exposing a permanent TURN password in browser configuration.

Deploy the API behind HTTPS with WebSocket proxy support and the client over HTTPS. Browsers will block camera, microphone, and display capture on non-secure origins outside localhost. Set a strong unique JWT secret, restrict CORS, configure MongoDB authentication/network access, and use a managed TURN service. Socket.IO signaling is authenticated when a JWT is provided; the app permits anonymous guest socket joins for link-based meetings. JWTs are stored in localStorage in this demo, so production deployments should consider HttpOnly secure cookies and CSRF defenses.

## Application behavior and limits

- Sign up and sign in use bcrypt password hashing and JWT-protected profile/room API routes.
- Socket.IO validates and bounds chat, display names, signaling payloads, and drawing data. React renders chat as text, not HTML.
- Video and audio use a peer-to-peer mesh. Each browser sends a separate stream to every other participant, so this implementation is best for small groups; use an SFU (such as LiveKit, mediasoup, or Janus) for larger rooms and production scale.
- Whiteboard strokes synchronize while participants are connected; there is no durable board history or replay for late joiners.
- Files up to 12 MB are read locally and sent through WebRTC data channels to connected peers. The sender sees its own local file entry. The transfer is not relayed or persisted and requires an established peer connection; transfer progress, resume, and file scanning are not included.
- WebRTC media is encrypted in transit by the browser's DTLS-SRTP implementation. This is transport encryption, not a claim of application-managed end-to-end identity verification. HTTPS/WSS is required in production.

## Production build

Run `npm run build` to build the static client into `client/dist`; `npm start` launches the Express server, which serves both the API/signaling endpoints and the built React app. The client uses the same origin for API and Socket.IO in production. During Vite development it uses `http://localhost:4000` by default; set `VITE_API_URL` in `client/.env.local` if your API uses another local origin.

## Deploy to Railway

This repository is configured as a single Railway web service. Railway uses the root `railway.json`, installs the npm workspaces, runs `npm run build`, then starts `npm start`. Express serves `client/dist`, so one public domain handles the site, REST API, and Socket.IO signaling.

1. Sign in to Railway, create a project, choose **Deploy from GitHub repo**, and select `modugumudibharathsai-lab/task4`. Allow Railway to access the repository if asked.
2. Add a MongoDB database reachable from Railway, either through Railway's MongoDB template or an external MongoDB provider. Copy its connection string.
3. In the app service's **Variables** settings, add `MONGODB_URI` with that connection string and `JWT_SECRET` with a unique random value of at least 32 characters. You can also set `JWT_EXPIRES_IN` (default `1d`). Railway supplies `PORT` and `RAILWAY_PUBLIC_DOMAIN`; the server uses the assigned port and allows the Railway public origin for Socket.IO. If you use a custom domain or separate client origin, set `CLIENT_ORIGIN` to the exact origin, including `https://` (multiple origins may be comma-separated).
4. In **Settings → Networking**, generate a public domain (or attach your custom domain), then wait for the deployment health check at `/api/health` to pass.
5. Open the generated HTTPS domain, create an account, and start a meeting. For reliable calling through restrictive networks, configure a TURN service. Vite build-time TURN variables must be set on the Railway service before deployment as `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL`.

Do not set a fixed `PORT` on Railway and do not commit `.env` files. Keep `MONGODB_URI`, `JWT_SECRET`, and TURN credentials in Railway's Variables settings.
