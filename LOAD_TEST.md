# Load Testing & Performance Validation - Phase 3

## Overview

This document describes the comprehensive load testing suite for the QR Access Backend system. The goal is to validate production readiness under realistic and extreme traffic scenarios.

## Quick Start

### Prerequisites
- Node.js 16+ installed
- Backend running on `http://localhost:3001`
- ~45 minutes for full test suite (5 min + 3 min + 15 min scenarios)

### Running Tests

**Run all scenarios:**
```bash
./run-load-tests.sh all
```

**Run individual scenarios:**
```bash
./run-load-tests.sh happy-path  # 5 minutes
./run-load-tests.sh stress       # 3 minutes
./run-load-tests.sh endurance    # 15+ minutes
```

**With custom base URL:**
```bash
BASE_URL=http://example.com:3001 ./run-load-tests.sh all
```

Results are saved to `./load-test-results/` as JSON files.

---

## Test Architecture

### Load Test Tools

**Primary Tool: Node.js HTTP Client** (`load-test-runner.js`)
- No external dependencies required (pure Node.js)
- Built-in memory profiling
- Detailed metrics collection (response times, error rates, throughput)
- Virtual User (VU) simulation
- Real-time reporting

**Alternative: k6 Script** (`load-test.js`)
- Requires k6 installation: `brew install k6`
- More sophisticated test scenarios
- Better for advanced metrics and custom thresholds
- Run with: `k6 run load-test.js --vus=100 --duration=5m`

### Metrics Collected

For each endpoint, we measure:
- **Count**: Total number of requests
- **Response Times**: min, max, avg, p50, p95, p99 (milliseconds)
- **Error Rate**: Percentage of failed requests
- **Status Codes**: Distribution of HTTP response codes

For the entire test:
- **Throughput**: Requests per second
- **Error Rate**: Overall error percentage
- **Rate Limit Hits**: Number of 429 responses
- **Memory Usage**: Heap used, RSS, over time

---

## Test Scenarios

### Scenario 1: Happy Path (5 minutes)

**Purpose**: Validate normal production traffic patterns

**Configuration**:
- **Load Profile**: 100 concurrent users
  - Ramp-up: 0→50 VUs over 1 minute
  - Ramp-up: 50→100 VUs over 3 minutes
  - Steady: 100 VUs for 5 minutes
  - Ramp-down: 100→0 VUs over 1 minute

**Request Distribution**:
- 70% Verify Token (GET /api/verify)
- 20% Check-In (POST /api/check-in)
- 10% Generate QR (POST /api/generate-qr)
- ~2% Health checks (GET /health)

**Expected Duration**: ~10 minutes total (4 min ramp-up + 5 min steady + 1 min ramp-down)

**Success Criteria**:
- p95 response time < 2000ms
- Error rate < 1%
- Throughput > 50 req/sec
- No unexpected 429 rate limit errors

### Scenario 2: Stress Test (1 minute spike)

**Purpose**: Validate system resilience under sudden traffic spikes

**Configuration**:
- **Load Profile**: Spike to 500 concurrent users
  - Ramp-up: 0→100 VUs over 30 seconds
  - Spike: 100→500 VUs over 60 seconds (adds 6.67 VUs/second)
  - Sustained: 500 VUs for 60 seconds
  - Ramp-down: 500→0 VUs over 30 seconds

**Request Distribution**:
- 40% Verify Token
- 40% Check-In
- 20% Generate QR

**Expected Duration**: ~3 minutes total

**Success Criteria**:
- System remains responsive (p95 < 3000ms is acceptable)
- Error rate < 5% (temporary spike acceptable)
- Graceful degradation (no crashes or hangs)
- System recovers when load decreases

### Scenario 3: Endurance Test (15 minutes)

**Purpose**: Detect memory leaks and performance degradation over time

**Configuration**:
- **Load Profile**: Sustained 50 concurrent users
  - Ramp-up: 0→50 VUs over 1 minute
  - Sustained: 50 VUs for 15 minutes
  - Ramp-down: 50→0 VUs over 1 minute

**Request Distribution**:
- 50% Verify Token
- 30% Check-In
- 15% Generate QR
- 5% Check-In Status

**Expected Duration**: ~17 minutes total

**Memory Snapshots**: Recorded every 30 seconds to detect:
- Unbounded memory growth (memory leak)
- Memory stability under sustained load
- Garbage collection effectiveness

**Success Criteria**:
- Memory heap usage remains stable (variance < 20%)
- No continuous memory growth
- Response times don't degrade over time
- CPU usage remains reasonable (< 70%)
- Error rate < 1%

---

## Test Endpoints

All tests target the following endpoints:

### 1. Generate QR Token
```http
POST /api/generate-qr
Content-Type: application/json

{
  "member_id": "00147",
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "+1234567890",
  "agent": "LoadTestAgent"
}
```

**Expected Response (200 OK)**:
```json
{
  "token": "abc123def456...",
  "member_id": "00147",
  "expiresAt": "2026-05-18T12:00:00Z"
}
```

### 2. Verify Token
```http
GET /api/verify?token=abc123def456...
```

**Expected Response (200 OK)**:
```json
{
  "member_id": "00147",
  "name": "John Doe",
  "email": "john@example.com",
  "verified": true
}
```

### 3. Check-In
```http
POST /api/check-in
Content-Type: application/json

{
  "token": "abc123def456..."
}
```

**Expected Response (200 OK)**:
```json
{
  "check_in_time": "2026-05-18T11:45:00Z",
  "member_id": "00147",
  "status": "checked_in"
}
```

### 4. Check-In Status
```http
GET /api/check-in-status?token=abc123def456...
```

**Expected Response (200 OK)**:
```json
{
  "token": "abc123def456...",
  "status": "checked_in",
  "check_in_time": "2026-05-18T11:45:00Z"
}
```

### 5. Health Check
```http
GET /health
```

**Expected Response (200 OK)**:
```json
{
  "status": "OK",
  "timestamp": "2026-05-18T11:45:00Z"
}
```

---

## Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| **p95 Response Time** | < 2000ms | Acceptable for user-facing APIs |
| **p99 Response Time** | < 3000ms | 99th percentile acceptable threshold |
| **Error Rate** | < 1% | Industry standard for production APIs |
| **Throughput** | > 50 req/sec | Minimum capacity requirement |
| **Memory Growth** | < 20% variance | Detect memory leaks during endurance |
| **CPU Usage** | < 70% at 50 VUs | Reasonable headroom for peaks |

---

## Running Load Tests

### Step 1: Start the Backend

```bash
# In another terminal
cd qr-access-backend
npm install  # if not already done
npm start
```

Verify it's running:
```bash
curl http://localhost:3001/health
# Should return: {"status":"OK","timestamp":"..."}
```

### Step 2: Run Load Tests

```bash
# Run all scenarios (takes ~45 minutes)
./run-load-tests.sh all

# Or run individual scenarios
./run-load-tests.sh happy-path
./run-load-tests.sh stress
./run-load-tests.sh endurance
```

### Step 3: Monitor Progress

While tests are running, you can monitor in another terminal:

```bash
# Watch the results directory
watch ls -lah load-test-results/

# Monitor backend resource usage (macOS)
top -u $(whoami)

# Or with more detail
ps aux | grep "node server.js"
```

### Step 4: Analyze Results

Results are saved as JSON files in `load-test-results/`:

```bash
# View results
ls load-test-results/

# Pretty-print a result
cat load-test-results/happy-path-*.json | jq .

# Extract summary stats
cat load-test-results/happy-path-*.json | jq .results.endpointStats
```

---

## Interpreting Results

### Response Time Analysis

```json
{
  "verify_token": {
    "p50": 120,    // Median response time
    "p95": 850,    // 95th percentile (good indicator of user experience)
    "p99": 1200,   // 99th percentile (worst 1% of users)
    "avg": 300     // Average
  }
}
```

**Interpretation**:
- **p50 (Median)**: Most users experience this response time
- **p95**: Only 5% of users experience slower response times
- **p99**: Only 1% of users experience this slow response
- **Good Pattern**: p95 < 2s means 95% of users get good experience

### Error Rate Analysis

```json
{
  "verify_token": {
    "count": 15000,
    "errors": 150,
    "errorRate": "1.00%"
  }
}
```

**Interpretation**:
- < 1% is excellent (99.9% availability)
- 1-2% is acceptable (can monitor and optimize)
- > 2% indicates issues (rate limiting, database problems, etc.)

### Throughput Analysis

```
Throughput: 250 req/sec
```

**Interpretation**:
- Single server handling 250 requests/second
- Headroom before saturation
- Scale to production load by adding more servers/replicas

### Status Code Distribution

```json
{
  "statusCodes": {
    "200": 45000,
    "201": 3000,
    "429": 500,
    "500": 50
  }
}
```

**Interpretation**:
- **200/201**: Successful responses
- **429**: Rate limiting (check if threshold too strict)
- **500**: Server errors (investigate logs)

---

## Troubleshooting

### Issue: "Backend is not responding"

**Solution**:
```bash
# Check if backend is running
curl http://localhost:3001/health

# If not, start it
cd qr-access-backend
npm start

# Wait for startup message:
# "SIDEON QR Access Backend listening on port 3001"
```

### Issue: High Error Rate (> 5%)

**Likely Causes**:
1. **Rate Limiting** (429 responses)
   - Check `middleware/rateLimiter.js`
   - Consider increasing rate limit for load testing
   - See error breakdown in results

2. **Database Locks** (500 errors)
   - SQLite has limited concurrent write support
   - Monitor with: `lsof | grep access.db`

3. **Memory Issues** (500 errors, crashes)
   - Check memory snapshots in results
   - May need to reduce VU count

4. **Missing Database** (500 errors)
   - Verify `access.db` exists
   - Check database initialization in logs

### Issue: Memory Growing Unbounded

**Investigation Steps**:
1. Check memory snapshots in endurance test results
2. Look for patterns:
   - Slow linear growth = cache accumulation
   - Sudden jumps = memory leak event
   - Stable = healthy

3. Common culprits:
   - Token/user cache in memory
   - Event listeners not cleaned up
   - Database connection pool issues

**Solution**:
- Add memory limits: `node --max-old-space-size=512 server.js`
- Profile with: `node --prof server.js` then `node --prof-process`

### Issue: p95 Response Time > 2000ms

**Likely Causes**:
1. **Database Contention**
   - SQLite locks during writes
   - Monitor: `lsof | grep access.db`

2. **Too Many VUs**
   - Try reducing from 100 to 50
   - Measure saturation point

3. **Slow Endpoint**
   - Check which endpoint has high p95
   - Profile that endpoint: `node --prof`

---

## Production Deployment Checklist

Use these load test results to validate production readiness:

- [ ] **p95 Response Time < 2000ms**: Meet target in happy path scenario
- [ ] **Error Rate < 1%**: No unexpected errors under normal load
- [ ] **Stress Test Passes**: System recovers gracefully from 500 VU spike
- [ ] **No Memory Leaks**: Endurance test shows stable memory usage
- [ ] **Throughput Headroom**: Measured > 100 req/sec (2x minimum target)
- [ ] **Rate Limiting Tuned**: 429 rate limit errors acceptable or adjusted
- [ ] **Database Performance**: No SQLite lock contention issues
- [ ] **Logging Reviewed**: Audit logs captured correctly under load
- [ ] **Monitoring Setup**: Prometheus/CloudWatch metrics configured
- [ ] **Backup/Recovery**: Tested database backup and restore under load

---

## Advanced: Custom Scenarios

### Modifying VU Profile

Edit `load-test-runner.js`:

```javascript
const distribution = [
  0.1,  // % Generate QR
  0.7,  // % Verify
  0.2,  // % Check-In
  0.0,  // % Check-In Status
  0.0   // % Health
];
```

### Extending Test Duration

Edit `run-load-tests.sh` timeout values:

```bash
# Default 600 seconds = 10 minutes
timeout 1200 node load-test-runner.js  # 20 minutes

# Or set via environment
DURATION=1200 ./run-load-tests.sh happy-path
```

### Using k6 for Distributed Testing

If you install k6:

```bash
brew install k6

k6 run load-test.js \
  --vus=100 \
  --duration=5m \
  --rps=500 \
  --out json=results.json
```

---

## Metrics Reference

### HTTP Request Metrics
- `http_req_duration`: Total time to complete request (ms)
- `http_req_duration_p95`: 95th percentile response time
- `http_req_failed`: Count of failed requests
- `http_req_connecting`: Time to establish connection
- `http_req_waiting`: Time waiting for response (server processing)

### Custom Metrics (from load test runner)
- `generate_qr_duration`: Generate QR endpoint response time
- `verify_token_duration`: Verify endpoint response time
- `check_in_duration`: Check-in endpoint response time
- `total_requests`: Total requests made
- `rate_limit_hits`: Number of 429 responses

### Memory Metrics
- `heapUsed`: JavaScript heap in use (MB)
- `heapTotal`: Total JavaScript heap (MB)
- `external`: External C++ objects (MB)
- `rss`: Resident Set Size - total memory (MB)

---

## References

- **Backend Code**: `server.js`, `routes/qrRoutes.js`, `controllers/qrController.js`
- **Database**: `utils/database.js` (SQLite)
- **Rate Limiting**: `middleware/rateLimiter.js`
- **Test Results**: `load-test-results/`
- **k6 Documentation**: https://k6.io/docs
- **Load Testing Guide**: https://en.wikipedia.org/wiki/Load_testing

---

## Support

**Issues or Questions?**

1. Check the logs: `cat load-test-results/load-test-*.log`
2. Review endpoint implementations
3. Check database state: `sqlite3 access.db ".tables"`
4. Monitor backend: `tail -f logs/*.log`

**Performance Optimization Tips**:
1. Index frequently queried columns
2. Cache tokens in memory with TTL
3. Use connection pooling for database
4. Implement request batching
5. Consider read replicas for SQLite

---

## Version History

**Phase 3 - Load Testing Suite**
- Created comprehensive load test infrastructure
- Implemented three test scenarios (happy path, stress, endurance)
- Added automated reporting and metrics collection
- Documented success criteria and troubleshooting guide

**Next Steps**:
- Monitor Phase 3 results
- Optimize bottlenecks identified
- Plan Phase 4: Security & Compliance Testing
