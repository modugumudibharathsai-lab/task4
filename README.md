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

## Deploy to Railway or Render

This repository supports single-service deployment on Railway and Render. Both hosts can build the root npm workspaces and run the Express server, which serves `client/dist`, the REST API, and Socket.IO on one public domain. `railway.json` configures Railway; `render.yaml` configures Render.

### Render

1. Sign in to Render and create a **Blueprint** from this repository: <https://dashboard.render.com/blueprints>. Render needs GitHub access to read the repository and its `render.yaml` file.
2. The Blueprint defines one Node web service on Render's free plan, using the Singapore region, `npm install && npm run build`, `npm start`, and `/api/health` for health checks. Review the plan in Render before creating it; free services can sleep when idle, which may delay the first visit and interrupt long-lived meetings during host maintenance.
3. Provide `MONGODB_URI` when Render prompts for it. Use a reachable MongoDB Atlas connection string and configure Atlas network access and a database user. Render generates `JWT_SECRET` for the service. Do not paste database credentials into source files or commit them.
4. Create the Blueprint and wait for the health check to pass. Render sets `PORT` and `RENDER_EXTERNAL_URL`; the server uses these for its listener and Socket.IO origin.
5. Open the service's HTTPS URL, create an account, and start a meeting. For reliable calls through restrictive networks, configure a TURN server. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` on the Render service before building.

### Railway

1. Create a project and choose **Deploy from GitHub repo**, then select `modugumudibharathsai-lab/task4`.
2. Add a reachable MongoDB connection string as `MONGODB_URI` and set `JWT_SECRET` to a unique random value of at least 32 characters. Optionally set `JWT_EXPIRES_IN` (default `1d`).
3. Generate a public domain under **Settings → Networking**. Railway supplies `PORT` and `RAILWAY_PUBLIC_DOMAIN`; the server uses them for the listener and Socket.IO origin.
4. Wait for `/api/health` to pass, then open the generated HTTPS domain.

Do not set a fixed `PORT` on Railway or Render and do not commit `.env` files. Keep `MONGODB_URI`, `JWT_SECRET`, and TURN credentials in the hosting provider's secret variables.
