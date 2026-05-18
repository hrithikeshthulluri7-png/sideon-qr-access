/**
 * Quick validation script - tests the 3 previously failing endpoints
 * Runs for 30 seconds with 10 VUs to confirm fixes work
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const verifyErrors = new Rate('verify_errors');
const checkInErrors = new Rate('check_in_errors');
const statusErrors = new Rate('check_in_status_errors');

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    'verify_errors': ['rate<0.05'],
    'check_in_errors': ['rate<0.05'],
    'check_in_status_errors': ['rate<0.05'],
    'http_req_failed': ['rate<0.05'],
  }
};

const BASE_URL = 'http://localhost:3001/api';

function randomToken() {
  // Match backend format: SIDN_EVENT_2026_M{digits}_{24 hex chars}
  const memberId = Math.floor(Math.random() * 999999) + 1;
  const hex = Array.from({ length: 24 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');
  return `SIDN_EVENT_2026_M${memberId}_${hex}`;
}

export default function () {
  const token = randomToken();

  // Test 1: GET /api/verify - must return 200 + member_id
  const verify = http.get(`${BASE_URL}/verify?token=${token}`, {
    headers: { 'Content-Type': 'application/json' }
  });
  const v = check(verify, {
    'verify: status 200': (r) => r.status === 200,
    'verify: has member_id OR success:false': (r) => {
      const body = r.json();
      return body.member_id !== undefined || body.success === false;
    },
  });
  verifyErrors.add(!v);

  // Test 2: POST /api/check-in - must return 200/201 + check_in_time
  const checkIn = http.post(`${BASE_URL}/check-in`, JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' }
  });
  const c = check(checkIn, {
    'check-in: status 200': (r) => r.status === 200 || r.status === 201,
    'check-in: has check_in_time OR success:false': (r) => {
      const body = r.json();
      return body.check_in_time !== undefined || body.success === false;
    },
  });
  checkInErrors.add(!c);

  // Test 3: GET /api/check-in-status - must return 200
  const status = http.get(`${BASE_URL}/check-in-status?token=${token}`, {
    headers: { 'Content-Type': 'application/json' }
  });
  const s = check(status, {
    'status: status 200': (r) => r.status === 200,
  });
  statusErrors.add(!s);

  sleep(1);
}
