import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import authRoutes from '../src/routes/auth.js';
import { connectStorage } from '../src/storage.js';

process.env.NODE_ENV = 'test';
process.env.DEV_MEMORY_STORE = 'true';
process.env.JWT_SECRET = 'orbit-auth-test-secret-with-at-least-thirty-two-characters';

before(async () => { await connectStorage(); });

async function request(method, path, body, authorization = '') {
  const layer = authRoutes.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} exists`);
  const handlers = layer.route.stack.map(item => item.handle);
  const req = { body, get: name => name.toLowerCase() === 'authorization' ? authorization : undefined };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  let index = 0;
  const next = async error => {
    if (error) throw error;
    index += 1;
    if (index < handlers.length) return handlers[index](req, res, next);
  };
  await handlers[0](req, res, next);
  return { status: res.statusCode, body: res.body };
}

test('signup validates inputs, prevents duplicates, and supports login and authenticated profile', async () => {
  const invalid = await request('post', '/signup', { name: 'A', email: 'not-an-email', password: 'short' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /valid email/i);

  const email = `auth-test-${crypto.randomUUID()}@example.com`;
  const credentials = { name: 'Test Member', email, password: 'LocalTestPassword123!' };
  const signup = await request('post', '/signup', credentials);
  assert.equal(signup.status, 201);
  const created = signup.body;
  assert.ok(created.token);
  assert.equal(typeof created.user.id, 'string');
  assert.deepEqual({ name: created.user.name, email: created.user.email }, { name: 'Test Member', email });
  assert.equal(Object.hasOwn(created.user, 'passwordHash'), false);

  const duplicate = await request('post', '/signup', credentials);
  assert.equal(duplicate.status, 409);

  const login = await request('post', '/login', { email, password: credentials.password });
  assert.equal(login.status, 200);
  const loggedIn = login.body;
  assert.ok(loggedIn.token);

  const profile = await request('get', '/me', undefined, `Bearer ${loggedIn.token}`);
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body, { user: { id: created.user.id, name: credentials.name, email } });

  const wrongPassword = await request('post', '/login', { email, password: 'WrongPassword123!' });
  assert.equal(wrongPassword.status, 401);
});
