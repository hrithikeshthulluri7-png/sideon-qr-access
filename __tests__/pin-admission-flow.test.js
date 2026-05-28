/**
 * PIN → Admit → Check-in flow tests (Phase 4)
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET = 'test-secret';
process.env.ADMIN_SETUP_KEY = 'test-setup-key';

const request = require('supertest');
const app = require('../server');
const { db } = require('../utils/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { generateToken } = require('../utils/tokenGenerator');

// ── helpers ──────────────────────────────────────────────────────────────────

const adminToken = () =>
  jwt.sign({ id: 1, email: 'admin@test.com', name: 'Test Admin', role: 'admin' }, 'test-secret', { expiresIn: '1h' });

const seedMemberAndToken = (memberId, pin, admissionStatus = 'pending') =>
  new Promise((resolve, reject) => {
    const token = generateToken(memberId);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.serialize(() => {
      db.run(
        `INSERT OR REPLACE INTO members (member_id, name, email, admission_status) VALUES (?, ?, ?, ?)`,
        [memberId, 'Test User', 'test@test.com', admissionStatus],
        (err) => { if (err) return reject(err); }
      );

      bcrypt.hash(String(pin), 10).then(pinHash => {
        db.run(
          `INSERT INTO tokens (member_id, token, expiresAt, pin_hash) VALUES (?, ?, ?, ?)`,
          [memberId, token, expiresAt, pinHash],
          (err) => err ? reject(err) : resolve(token)
        );
      }).catch(reject);
    });
  });

const cleanupMember = (memberId) => new Promise(resolve => {
  db.run('DELETE FROM tokens WHERE member_id = ?', [memberId], () => {
    db.run('DELETE FROM members WHERE member_id = ?', [memberId], resolve);
  });
});

// ── POST /api/generate-qr ─────────────────────────────────────────────────────

describe('POST /api/generate-qr (Phase 4 — PIN generation)', () => {
  const memberId = 'TESTGEN001';
  afterEach(() => cleanupMember(memberId));

  it('returns a 6-digit PIN in the response', async () => {
    const res = await request(app)
      .post('/api/generate-qr')
      .send({ member_id: memberId, name: 'PIN Test User' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    expect(res.body.token).toBeTruthy();
  });

  it('sets admission_status to pending on the member', async () => {
    await request(app)
      .post('/api/generate-qr')
      .send({ member_id: memberId, name: 'PIN Test User' });

    await new Promise(resolve => {
      db.get('SELECT admission_status FROM members WHERE member_id = ?', [memberId], (err, row) => {
        expect(row.admission_status).toBe('pending');
        resolve();
      });
    });
  });
});

// ── POST /api/admin/login ─────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  const email = 'logintest@sideon.com';
  const password = 'SecurePass123';

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 10);
    await new Promise(resolve => {
      db.run(
        'INSERT OR REPLACE INTO admin_users (email, password_hash, name) VALUES (?, ?, ?)',
        [email, hash, 'Login Tester'],
        resolve
      );
    });
  });

  afterAll(() => new Promise(resolve => {
    db.run('DELETE FROM admin_users WHERE email = ?', [email], resolve);
  }));

  it('returns JWT on valid credentials', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, 'test-secret');
    expect(decoded.role).toBe('admin');
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email, password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: 'nobody@nowhere.com', password });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/admit ─────────────────────────────────────────────────────

describe('POST /api/admin/admit + /api/admin/decline', () => {
  const memberId = 'TESTADMIT001';
  beforeEach(() => seedMemberAndToken(memberId, '123456'));
  afterEach(() => cleanupMember(memberId));

  it('admits a pending member', async () => {
    const res = await request(app)
      .post('/api/admin/admit')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await new Promise(resolve => {
      db.get('SELECT admission_status FROM members WHERE member_id = ?', [memberId], (err, row) => {
        expect(row.admission_status).toBe('admitted');
        resolve();
      });
    });
  });

  it('declines a pending member', async () => {
    const res = await request(app)
      .post('/api/admin/decline')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await new Promise(resolve => {
      db.get('SELECT admission_status FROM members WHERE member_id = ?', [memberId], (err, row) => {
        expect(row.admission_status).toBe('declined');
        resolve();
      });
    });
  });

  it('rejects unauthenticated admit', async () => {
    const res = await request(app)
      .post('/api/admin/admit')
      .send({ member_id: memberId });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/verify-pin ──────────────────────────────────────────────────────

describe('POST /api/verify-pin', () => {
  const memberId = 'TESTPIN001';
  const correctPin = '654321';
  let tokenStr;

  beforeEach(async () => {
    tokenStr = await seedMemberAndToken(memberId, correctPin);
  });
  afterEach(() => cleanupMember(memberId));

  it('rejects PIN when member is not yet admitted', async () => {
    const res = await request(app)
      .post('/api/verify-pin')
      .send({ token: tokenStr, pin: correctPin });

    expect(res.status).toBe(403);
  });

  it('admits member then accepts correct PIN and marks checked-in', async () => {
    // Admit via admin
    await request(app)
      .post('/api/admin/admit')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    const res = await request(app)
      .post('/api/verify-pin')
      .send({ token: tokenStr, pin: correctPin });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.checked_in_at).toBeTruthy();
  });

  it('rejects wrong PIN', async () => {
    await request(app)
      .post('/api/admin/admit')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    const res = await request(app)
      .post('/api/verify-pin')
      .send({ token: tokenStr, pin: '000000' });

    expect(res.status).toBe(401);
  });

  it('prevents double check-in', async () => {
    await request(app)
      .post('/api/admin/admit')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    await request(app).post('/api/verify-pin').send({ token: tokenStr, pin: correctPin });

    const res2 = await request(app)
      .post('/api/verify-pin')
      .send({ token: tokenStr, pin: correctPin });

    expect(res2.status).toBe(409);
  });
});

// ── POST /api/get-admission-status ────────────────────────────────────────────

describe('POST /api/get-admission-status', () => {
  const memberId = 'TESTSTATUS001';
  let tokenStr;

  beforeEach(async () => {
    tokenStr = await seedMemberAndToken(memberId, '111111', 'pending');
  });
  afterEach(() => cleanupMember(memberId));

  it('returns pending status initially', async () => {
    const res = await request(app)
      .post('/api/get-admission-status')
      .send({ token: tokenStr });

    expect(res.status).toBe(200);
    expect(res.body.admission_status).toBe('pending');
  });

  it('reflects admitted status after admin action', async () => {
    await request(app)
      .post('/api/admin/admit')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ member_id: memberId });

    const res = await request(app)
      .post('/api/get-admission-status')
      .send({ token: tokenStr });

    expect(res.body.admission_status).toBe('admitted');
  });

  it('returns 400 when token missing', async () => {
    const res = await request(app)
      .post('/api/get-admission-status')
      .send({});

    expect(res.status).toBe(400);
  });
});
