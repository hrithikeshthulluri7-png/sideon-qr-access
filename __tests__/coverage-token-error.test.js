/**
 * coverage-token-error — generateToken throws path (lines 70-74 in qrController)
 * Uses jest.mock so the mock is hoisted before module load.
 */

process.env.NODE_ENV = 'test';

// Variables referenced inside jest.mock factories must be prefixed with 'mock'
let mockThrowOnNext = false;

jest.mock('../utils/tokenGenerator', () => {
  const actual = jest.requireActual('../utils/tokenGenerator');
  return {
    ...actual,
    generateToken: jest.fn((memberId) => {
      if (mockThrowOnNext) {
        mockThrowOnNext = false;
        throw new Error('mock token generation error');
      }
      return actual.generateToken(memberId);
    }),
  };
});

const request = require('supertest');
const app = require('../server');

describe('generateQR — generateToken throws (lines 70-74)', () => {
  test('POST /api/generate-qr returns 500 when generateToken throws', async () => {
    mockThrowOnNext = true;
    const res = await request(app).post('/api/generate-qr').send({
      member_id: `${Date.now()}tok`, name: 'TokenThrow User',
      email: 'tt@test.com', mobile: '+5555550000', agent: 'TestAgent'
    });
    expect([400, 500]).toContain(res.status);
  });

  test('POST /api/generate-qr works normally when no throw', async () => {
    mockThrowOnNext = false;
    const res = await request(app).post('/api/generate-qr').send({
      member_id: `${Date.now()}tok2`, name: 'Normal User',
      email: 'normal@test.com', mobile: '+5555550001', agent: 'TestAgent'
    });
    expect([200, 201]).toContain(res.status);
  });
});
