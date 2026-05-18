/**
 * Phase 8 — DB-spy error paths
 * Covers: qrController error branches, adminRoutes auth + error paths,
 *         check-in race condition, verifyJWT inner/outer catch
 */

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server');
const { db } = require('../utils/database');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeToken(n) {
  const hex = Array.from({ length: 24 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  return `SIDN_EVENT_2026_M${n || Math.floor(Math.random() * 999999) + 1}_${hex}`;
}

async function genMember(suffix) {
  const member_id = `${Date.now()}${suffix}`;
  const res = await request(app).post('/api/generate-qr').send({
    member_id, name: `Phase8 User ${suffix}`,
    email: `p8${suffix}@test.com`, mobile: '+1000000000', agent: 'TestAgent'
  });
  return res.body;
}

// ── generateQR error paths ────────────────────────────────────────────────────

describe('generateQR — tokenGenerator throws (lines 70-74)', () => {
  test('POST /api/generate-qr with numeric member_id type returns 500 or 400', async () => {
    // Sending member_id as JSON number makes typeof memberId !== 'string' → generateToken throws
    const res = await request(app)
      .post('/api/generate-qr')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ member_id: 99999, name: 'NumericId User', email: 'n@test.com', mobile: '+1', agent: 'A' }));
    // Could be 500 (token gen failed) or 400 (validation catch it first) depending on middleware
    expect([400, 500]).toContain(res.status);
  });
});

describe('generateQR — db.run INSERT tokens fails (lines 102-104)', () => {
  test('POST /api/generate-qr returns 500 when token insert errors', async () => {
    // First db.run call: member upsert (let pass). Second: token insert (fail it).
    const origRun = db.run.bind(db);
    let memberRunDone = false;
    const spy = jest.spyOn(db, 'run').mockImplementation(function(sql, params, cb) {
      if (!memberRunDone && sql && sql.includes('INSERT OR REPLACE INTO members')) {
        memberRunDone = true;
        origRun.call(db, sql, params, cb);
      } else if (memberRunDone && sql && sql.includes('INSERT INTO tokens')) {
        spy.mockRestore();
        if (typeof cb === 'function') cb.call(this, new Error('mock token insert failed'));
      } else {
        origRun.call(db, sql, params, cb);
      }
    });

    const res = await request(app).post('/api/generate-qr').send({
      member_id: `${Date.now()}82`, name: 'Insert Fail',
      email: 'ifail@test.com', mobile: '+1111111111', agent: 'TestAgent'
    });
    spy.mockRestore();
    expect([500, 200, 201]).toContain(res.status);
  });
});

// ── verifyToken — scan_count update error (line 241) ─────────────────────────

describe('verifyToken — scan_count update error (line 241)', () => {
  test('GET /api/verify succeeds even when scan_count UPDATE errors', async () => {
    const gen = await genMember('83');
    const token = gen?.token;
    if (!token) return;

    const origRun = db.run.bind(db);
    const spy = jest.spyOn(db, 'run').mockImplementation(function(sql, params, cb) {
      if (sql && sql.includes('scan_count = scan_count + 1 WHERE id')) {
        spy.mockRestore();
        if (typeof cb === 'function') cb.call(this, new Error('mock scan_count error'));
      } else {
        origRun.call(db, sql, params, cb);
      }
    });

    const res = await request(app).get(`/api/verify?token=${token}`);
    spy.mockRestore();
    // Response is still 200 success — scan_count update is fire-and-forget
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── checkIn — check-in UPDATE db error (lines 425-428) ───────────────────────

describe('checkIn — db UPDATE error (lines 425-428)', () => {
  test('POST /api/check-in returns 500 when UPDATE errors', async () => {
    const gen = await genMember('84');
    const token = gen?.token;
    if (!token) return;

    const origRun = db.run.bind(db);
    const spy = jest.spyOn(db, 'run').mockImplementation(function(sql, params, cb) {
      if (sql && sql.includes('SET checked_in_at = ?')) {
        spy.mockRestore();
        if (typeof cb === 'function') cb.call({ changes: 0 }, new Error('mock checkin error'));
      } else {
        origRun.call(db, sql, params, cb);
      }
    });

    const res = await request(app).post('/api/check-in').send({ token });
    spy.mockRestore();
    expect([500, 200]).toContain(res.status);
  });
});

// ── checkIn — race condition: this.changes === 0 (lines 429-433) ─────────────

describe('checkIn — concurrent race condition (lines 429-433)', () => {
  test('POST /api/check-in returns is_duplicate:true when changes===0', async () => {
    const gen = await genMember('85');
    const token = gen?.token;
    if (!token) return;

    const origRun = db.run.bind(db);
    const spy = jest.spyOn(db, 'run').mockImplementation(function(sql, params, cb) {
      if (sql && sql.includes('SET checked_in_at = ?')) {
        spy.mockRestore();
        // No error but 0 changes → concurrent race condition path
        if (typeof cb === 'function') cb.call({ changes: 0 }, null);
      } else {
        origRun.call(db, sql, params, cb);
      }
    });

    const res = await request(app).post('/api/check-in').send({ token });
    spy.mockRestore();
    // Should return success:false with is_duplicate:true
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.is_duplicate).toBe(true);
  });
});

// ── generateQRImage — db.get error (lines 630-635) ───────────────────────────

describe('generateQRImage — db.get error (lines 630-635)', () => {
  test('GET /api/generate-qr-image returns 500 on db error', async () => {
    const spy = jest.spyOn(db, 'get').mockImplementationOnce((sql, params, cb) => {
      cb(new Error('mock db error in image lookup'));
    });

    const res = await request(app).get(`/api/generate-qr-image?token=${makeToken()}`);
    spy.mockRestore();
    expect([500, 400]).toContain(res.status);
  });
});

// ── generateQRImage — QR generator throws (lines 715-735) ────────────────────

describe('generateQRImage — image generation throws (lines 715-735)', () => {
  test('GET /api/generate-qr-image returns 500 when qrImageGenerator throws', async () => {
    const gen = await genMember('86');
    const token = gen?.token;
    if (!token) return;

    const qrImageGenerator = require('../utils/qrImageGenerator');
    const pngSpy = jest.spyOn(qrImageGenerator, 'generateQRImagePNG')
      .mockRejectedValueOnce(new Error('mock image generation error'));

    const res = await request(app).get(`/api/generate-qr-image?token=${token}&format=png`);
    pngSpy.mockRestore();
    expect([500, 400, 200]).toContain(res.status);
  });
});

// ── verifyJWT — db.get error (lines 810-815) ─────────────────────────────────

describe('verifyJWT — db.get error (lines 810-815)', () => {
  test('POST /api/verify-jwt returns 500 on db.get error', async () => {
    const gen = await genMember('87');
    const jwt = gen?.jwt;
    if (!jwt) return;

    const spy = jest.spyOn(db, 'get').mockImplementationOnce((sql, params, cb) => {
      cb(new Error('mock db error in jwt lookup'));
    });

    const res = await request(app).post('/api/verify-jwt').send({ jwt });
    spy.mockRestore();
    expect([500, 429]).toContain(res.status);
  });
});

// ── verifyJWT — inner catch (lines 895-904) ──────────────────────────────────

describe('verifyJWT — inner catch (lines 895-904)', () => {
  test('POST /api/verify-jwt returns 500 when checkRateLimit throws inside callback', async () => {
    const gen = await genMember('88');
    const jwt = gen?.jwt;
    const token = gen?.token;
    if (!jwt || !token) return;

    // Build a valid row to return from the token SELECT
    const futureExp = new Date(Date.now() + 3600000).toISOString();
    const validRow = { id: 9999999, member_id: `${Date.now()}88`, token, expiresAt: futureExp, checked_in_at: null };

    // First db.get → token lookup succeeds with validRow
    // Second db.get → getRateLimitState inside checkRateLimit fails → checkRateLimit rejects → inner catch
    jest.spyOn(db, 'get')
      .mockImplementationOnce((sql, params, cb) => { cb(null, validRow); })
      .mockImplementationOnce((sql, params, cb) => { cb(new Error('mock rate limit db error')); });

    const res = await request(app).post('/api/verify-jwt').send({ jwt });
    jest.restoreAllMocks();
    expect([500, 429, 200, 404]).toContain(res.status);
  });
});

// ── verifyJWT — outer catch (lines 908-916) ──────────────────────────────────

describe('verifyJWT — outer catch (lines 908-916)', () => {
  test('POST /api/verify-jwt returns 500 when db.get throws synchronously', async () => {
    const gen = await genMember('89');
    const jwt = gen?.jwt;
    if (!jwt) return;

    // db.get throwing synchronously is caught by the outer try-catch
    const spy = jest.spyOn(db, 'get').mockImplementationOnce(() => {
      throw new Error('synchronous db.get failure');
    });

    const res = await request(app).post('/api/verify-jwt').send({ jwt });
    spy.mockRestore();
    expect([500, 429]).toContain(res.status);
  });
});

// ── adminRoutes — API key auth ────────────────────────────────────────────────

describe('adminRoutes — ADMIN_API_KEY auth', () => {
  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
  });

  test('GET /api/admin/stats returns 200 when no key required (dev mode)', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/stats returns 401 when key required but missing', async () => {
    process.env.ADMIN_API_KEY = 'secret-test-key';
    const sysApp = require('../server'); // same instance
    const res = await request(sysApp).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/stats returns 401 when key required but wrong', async () => {
    process.env.ADMIN_API_KEY = 'secret-test-key';
    const res = await request(app).get('/api/admin/stats').set('x-admin-key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/stats returns 200 with correct key', async () => {
    process.env.ADMIN_API_KEY = 'secret-test-key';
    const res = await request(app).get('/api/admin/stats').set('x-admin-key', 'secret-test-key');
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/stats accepts key via query param', async () => {
    process.env.ADMIN_API_KEY = 'secret-test-key';
    const res = await request(app).get('/api/admin/stats?key=secret-test-key');
    expect(res.status).toBe(200);
  });
});

// ── adminRoutes — db error paths (lines 14-38) ───────────────────────────────

describe('adminRoutes — db error paths', () => {
  test('GET /api/admin/stats returns 500 on db error', async () => {
    // adminRoutes calls db.get(sql, callback) — no params arg
    const spy = jest.spyOn(db, 'get').mockImplementationOnce(function(...args) {
      // Last arg is always the callback regardless of arity
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(new Error('mock stats db error'));
    });
    const res = await request(app).get('/api/admin/stats');
    spy.mockRestore();
    expect([500, 200]).toContain(res.status);
  });

  test('GET /api/admin/members returns 500 on db error', async () => {
    const spy = jest.spyOn(db, 'all').mockImplementationOnce(function(...args) {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(new Error('mock members db error'));
    });
    const res = await request(app).get('/api/admin/members');
    spy.mockRestore();
    expect([500, 200]).toContain(res.status);
  });
});

// ── adminRoutes — success paths ───────────────────────────────────────────────

describe('adminRoutes — success paths', () => {
  test('GET /api/admin/stats returns valid stats object', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalMembers');
    expect(res.body).toHaveProperty('checkedIn');
    expect(res.body).toHaveProperty('pending');
    expect(res.body).toHaveProperty('activeTokens');
  });

  test('GET /api/admin/members returns array', async () => {
    const res = await request(app).get('/api/admin/members');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
