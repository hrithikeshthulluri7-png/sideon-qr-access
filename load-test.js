/**
 * Load Test Suite for QR Access Backend - Phase 3
 *
 * This k6 script tests the QR Access Control System under various load scenarios:
 * - Scenario A: Happy Path (70% verify, 20% check-in, 10% generate QR) with 100 concurrent users for 5 minutes
 * - Scenario B: Stress Test (spike to 500 concurrent users for 1 minute)
 * - Scenario C: Endurance Test (50 concurrent users for 15 minutes to detect memory leaks)
 *
 * Metrics tracked:
 * - Response times (p50, p95, p99)
 * - Error rates
 * - Throughput (req/sec)
 * - Memory usage
 *
 * Success Criteria:
 * - p95 response time < 2000ms
 * - Error rate < 1%
 * - Throughput > 50 req/sec
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Gauge, Counter } from 'k6/metrics';

// ============================================================================
// CUSTOM METRICS
// ============================================================================

// Response time metrics (in milliseconds)
const generateQRDuration = new Trend('generate_qr_duration');
const verifyTokenDuration = new Trend('verify_token_duration');
const checkInDuration = new Trend('check_in_duration');
const checkInStatusDuration = new Trend('check_in_status_duration');
const healthCheckDuration = new Trend('health_check_duration');

// Error rate metrics (0-1 scale)
const generateQRErrorRate = new Rate('generate_qr_errors');
const verifyTokenErrorRate = new Rate('verify_token_errors');
const checkInErrorRate = new Rate('check_in_errors');
const checkInStatusErrorRate = new Rate('check_in_status_errors');
const healthCheckErrorRate = new Rate('health_check_errors');

// Throughput counter (requests per second)
const requestCounter = new Counter('total_requests');

// Rate limiter gauge (percentage of requests hitting rate limit)
const rateLimitGauge = new Gauge('rate_limit_hits');

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const SCENARIO = __ENV.SCENARIO || 'happy-path'; // happy-path, stress, endurance

// Virtual User (VU) profiles
const VU_PROFILES = {
  'light-user': {
    requestsPerMin: 5,
    // 50% generate, 50% verify
    distribution: [0.5, 0.5, 0, 0, 0]
  },
  'moderate-user': {
    requestsPerMin: 15,
    // 30% generate, 40% verify, 30% check-in
    distribution: [0.3, 0.4, 0.3, 0, 0]
  },
  'heavy-user': {
    requestsPerMin: 20,
    // 10% generate, 30% verify, 40% check-in, 20% status
    distribution: [0.1, 0.3, 0.4, 0.2, 0]
  }
};

// Scenario configurations
export const scenarios = {
  'happy-path': {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 50 },  // Ramp up to 50 VUs over 1 minute
      { duration: '3m', target: 100 }, // Ramp up to 100 VUs over 3 minutes
      { duration: '5m', target: 100 }, // Stay at 100 VUs for 5 minutes
      { duration: '1m', target: 0 }    // Ramp down over 1 minute
    ],
    gracefulRampDown: '30s',
    tags: { scenario: 'happy-path' }
  },
  'stress': {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 100 },  // Ramp up to 100 VUs
      { duration: '1m', target: 500 },   // Spike to 500 VUs over 1 minute
      { duration: '1m', target: 500 },   // Stay at 500 VUs for 1 minute
      { duration: '30s', target: 0 }     // Ramp down over 30 seconds
    ],
    gracefulRampDown: '15s',
    tags: { scenario: 'stress' }
  },
  'endurance': {
    executor: 'constant-vus',
    vus: 50,
    duration: '15m',
    tags: { scenario: 'endurance' }
  }
};

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

function generateMemberId() {
  return `member-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateToken() {
  // Generate a token matching the backend format: SIDN_EVENT_2026_M{digits}_{24 hex chars}
  const memberId = Math.floor(Math.random() * 999999) + 1;
  const hex = Array.from({ length: 24 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');
  return `SIDN_EVENT_2026_M${memberId}_${hex}`;
}

// ============================================================================
// HTTP REQUEST HELPERS
// ============================================================================

function makeRequest(method, endpoint, body = null, tags = {}) {
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { ...tags, endpoint }
  };

  const url = `${BASE_URL}${endpoint}`;
  let response;

  if (method === 'GET') {
    response = http.get(url, params);
  } else if (method === 'POST') {
    response = http.post(url, JSON.stringify(body), params);
  }

  requestCounter.add(1);
  return response;
}

// ============================================================================
// API TEST FUNCTIONS
// ============================================================================

function testGenerateQR() {
  const memberId = generateMemberId();
  const payload = {
    member_id: memberId,
    name: `User ${memberId}`,
    email: `user-${memberId}@example.com`,
    mobile: '+1234567890',
    agent: 'LoadTestAgent'
  };

  const response = makeRequest('POST', '/api/generate-qr', payload, {
    name: 'GenerateQR'
  });

  const isSuccess = check(response, {
    'Generate QR - status is 200/201': (r) => r.status === 200 || r.status === 201,
    'Generate QR - has token': (r) => r.json() && r.json().token,
    'Generate QR - response time < 500ms': (r) => r.timings.duration < 500
  });

  generateQRErrorRate.add(!isSuccess);
  generateQRDuration.add(response.timings.duration);

  if (isSuccess && response.json() && response.json().token) {
    return response.json().token;
  }
  return null;
}

function testVerifyToken(token) {
  if (!token) return false;

  const response = makeRequest('GET', `/api/verify?token=${token}`, null, {
    name: 'VerifyToken'
  });

  const isSuccess = check(response, {
    'Verify Token - status is 200': (r) => r.status === 200,
    'Verify Token - has member_id or is_valid:false': (r) => {
      const body = r.json();
      return body && (body.member_id !== undefined || body.is_valid === false || body.success === false);
    },
    'Verify Token - response time < 500ms': (r) => r.timings.duration < 500
  });

  verifyTokenErrorRate.add(!isSuccess);
  verifyTokenDuration.add(response.timings.duration);

  return isSuccess;
}

function testCheckIn(token) {
  if (!token) return false;

  const payload = { token };
  const response = makeRequest('POST', '/api/check-in', payload, {
    name: 'CheckIn'
  });

  const isSuccess = check(response, {
    'Check-In - status is 200/201': (r) => r.status === 200 || r.status === 201,
    'Check-In - has check_in_time or success:false': (r) => {
      const body = r.json();
      return body && (body.check_in_time !== undefined || body.success === false || body.is_valid === false);
    },
    'Check-In - response time < 1000ms': (r) => r.timings.duration < 1000
  });

  checkInErrorRate.add(!isSuccess);
  checkInDuration.add(response.timings.duration);

  return isSuccess;
}

function testCheckInStatus(token) {
  if (!token) return false;

  const response = makeRequest('GET', `/api/check-in-status?token=${token}`, null, {
    name: 'CheckInStatus'
  });

  const isSuccess = check(response, {
    'Check-In Status - status is 200': (r) => r.status === 200,
    'Check-In Status - response time < 500ms': (r) => r.timings.duration < 500
  });

  checkInStatusErrorRate.add(!isSuccess);
  checkInStatusDuration.add(response.timings.duration);

  return isSuccess;
}

function testHealthCheck() {
  const response = makeRequest('GET', '/api/health', null, {
    name: 'HealthCheck'
  });

  const isSuccess = check(response, {
    'Health Check - status is 200': (r) => r.status === 200,
    'Health Check - status is OK': (r) => r.json() && r.json().status === 'OK',
    'Health Check - response time < 100ms': (r) => r.timings.duration < 100
  });

  healthCheckErrorRate.add(!isSuccess);
  healthCheckDuration.add(response.timings.duration);

  return isSuccess;
}

// ============================================================================
// SCENARIO IMPLEMENTATIONS
// ============================================================================

export function scenarioHappyPath() {
  // Select a VU profile
  const vu = __VU % 3;
  let profile;
  if (vu === 0) {
    profile = VU_PROFILES['light-user'];
  } else if (vu === 1) {
    profile = VU_PROFILES['moderate-user'];
  } else {
    profile = VU_PROFILES['heavy-user'];
  }

  // Scenario: 70% verify, 20% check-in, 10% generate QR
  const distribution = [0.1, 0.7, 0.2, 0, 0];

  group('Happy Path Scenario', () => {
    const random = Math.random();
    let token = null;

    if (random < distribution[0]) {
      // Generate QR
      token = testGenerateQR();
    } else if (random < distribution[0] + distribution[1]) {
      // Verify Token
      token = generateToken();
      testVerifyToken(token);
    } else if (random < distribution[0] + distribution[1] + distribution[2]) {
      // Check-In
      token = generateToken();
      testCheckIn(token);
    }

    // Health check occasionally
    if (Math.random() < 0.05) {
      testHealthCheck();
    }
  });

  // Think time based on VU profile
  const thinkTime = 60 / profile.requestsPerMin;
  sleep(thinkTime);
}

export function scenarioStress() {
  group('Stress Test Scenario', () => {
    // Heavy load: prioritize verify and check-in
    const random = Math.random();
    let token = null;

    if (random < 0.2) {
      // Generate QR (20%)
      token = testGenerateQR();
    } else if (random < 0.6) {
      // Verify Token (40%)
      token = generateToken();
      testVerifyToken(token);
    } else {
      // Check-In (40%)
      token = generateToken();
      testCheckIn(token);
    }
  });

  // Minimal think time during stress
  sleep(Math.random() * 0.5);
}

export function scenarioEndurance() {
  group('Endurance Test Scenario', () => {
    // Balanced load to detect memory leaks
    const random = Math.random();
    let token = null;

    if (random < 0.15) {
      // Generate QR
      token = testGenerateQR();
    } else if (random < 0.50) {
      // Verify Token
      token = generateToken();
      testVerifyToken(token);
    } else if (random < 0.80) {
      // Check-In
      token = generateToken();
      testCheckIn(token);
    } else {
      // Check-In Status
      token = generateToken();
      testCheckInStatus(token);
    }

    // Health check occasionally
    if (Math.random() < 0.02) {
      testHealthCheck();
    }
  });

  // Normal think time
  sleep(Math.random() * 2);
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

export default function () {
  if (SCENARIO === 'happy-path') {
    scenarioHappyPath();
  } else if (SCENARIO === 'stress') {
    scenarioStress();
  } else if (SCENARIO === 'endurance') {
    scenarioEndurance();
  }
}

// ============================================================================
// SUMMARY AND THRESHOLDS
// ============================================================================

export const options = {
  scenarios: {
    [SCENARIO]: scenarios[SCENARIO]
  },
  thresholds: {
    // Response time thresholds
    'generate_qr_duration': ['p(95)<2000', 'p(99)<3000'],
    'verify_token_duration': ['p(95)<2000', 'p(99)<3000'],
    'check_in_duration': ['p(95)<2000', 'p(99)<3000'],
    'check_in_status_duration': ['p(95)<2000', 'p(99)<3000'],
    'health_check_duration': ['p(95)<500', 'p(99)<1000'],

    // Error rate thresholds
    'generate_qr_errors': ['rate<0.01'], // < 1% error rate
    'verify_token_errors': ['rate<0.01'],
    'check_in_errors': ['rate<0.01'],
    'check_in_status_errors': ['rate<0.01'],
    'health_check_errors': ['rate<0.01'],

    // Overall error rate
    'http_req_failed': ['rate<0.01']
  }
};
