# Load Test Execution Plan - Phase 3

## Execution Timeline

### Test Schedule

**Session Start**: 2026-05-18T00:17:00Z

#### Phase 1: Happy Path Scenario
- **Start Time**: T+0 minutes
- **Duration**: ~10 minutes total
  - Ramp-up (0→50 VUs): 1 minute
  - Ramp-up (50→100 VUs): 3 minutes
  - Steady state (100 VUs): 5 minutes
  - Ramp-down: 1 minute
- **Expected Completion**: T+10 minutes
- **Target Metrics**:
  - p95 response time < 2000ms
  - Error rate < 1%
  - Throughput > 50 req/sec

#### Phase 2: Stress Test Scenario
- **Start Time**: T+15 minutes (15 min buffer)
- **Duration**: ~3 minutes total
  - Ramp-up (0→100 VUs): 30 seconds
  - Spike (100→500 VUs): 60 seconds
  - Sustained (500 VUs): 60 seconds
  - Ramp-down: 30 seconds
- **Expected Completion**: T+18 minutes
- **Target Metrics**:
  - System remains responsive
  - Graceful degradation under spike
  - Error rate < 5% is acceptable

#### Phase 3: Endurance Test Scenario
- **Start Time**: T+25 minutes (25 min buffer)
- **Duration**: ~17 minutes total
  - Ramp-up (0→50 VUs): 1 minute
  - Sustained (50 VUs): 15 minutes (memory leak detection)
  - Ramp-down: 1 minute
- **Expected Completion**: T+42 minutes
- **Target Metrics**:
  - Memory usage stable (variance < 20%)
  - No unbounded growth
  - Response times don't degrade
  - Error rate < 1%

**Total Test Suite Duration**: ~45 minutes

---

## Test Environment Configuration

### Backend Setup
- **URL**: http://localhost:3001
- **Process**: Node.js single-threaded
- **Database**: SQLite (file-based, access.db)
- **Rate Limiting**: Express rate-limit middleware
  - Member operations: 100 req/min per member
  - Failure tracking: Limited per IP

### Virtual User Profiles

#### Happy Path (70% verify, 20% checkin, 10% generate)
- Light users: 5 requests/min (50% generate, 50% verify)
- Moderate users: 15 requests/min (30% generate, 40% verify, 30% checkin)
- Heavy users: 20 requests/min (10% generate, 30% verify, 40% checkin, 20% status)

#### Stress Test (40% verify, 40% checkin, 20% generate)
- Concentrated on verify and checkin
- Minimal think time
- Rapid-fire requests to trigger limits

#### Endurance Test (50% verify, 30% checkin, 15% generate, 5% status)
- Balanced distribution
- Normal think time (detection of memory issues)
- Low health check frequency

### Monitored Resources

**CPU Metrics**:
- Process CPU usage
- System-wide CPU at peak load
- Target: < 80% at 50 VUs

**Memory Metrics**:
- JavaScript heap (heapUsed, heapTotal)
- External memory usage
- RSS (resident set size)
- Snapshots every 30 seconds during endurance test

**Network Metrics**:
- Connection establishment time
- TLS handshake time (if HTTPS)
- Time to first byte (TTFB)

**Application Metrics**:
- Request count per endpoint
- Response time percentiles (p50, p95, p99)
- Error rates by status code
- Rate limit hits (429 responses)

---

## Success Criteria Matrix

### Tier 1: Critical (Must Pass)

| Metric | Target | Scenario | Status |
|--------|--------|----------|--------|
| p95 Response Time | < 2000ms | Happy Path | [ ] Pass |
| Error Rate | < 1% | Happy Path | [ ] Pass |
| System Stability | No crashes | Stress Test | [ ] Pass |
| Memory Leak Detection | Stable | Endurance Test | [ ] Pass |

### Tier 2: Important (Should Pass)

| Metric | Target | Scenario | Status |
|--------|--------|----------|--------|
| Throughput | > 50 req/sec | Happy Path | [ ] Pass |
| p99 Response Time | < 3000ms | Happy Path | [ ] Pass |
| Rate Limiting | < 5% 429s | Stress Test | [ ] Pass |
| CPU Usage | < 70% | Endurance Test | [ ] Pass |

### Tier 3: Informational (Track)

| Metric | Target | Scenario | Status |
|--------|--------|----------|--------|
| Database Contention | None | All | [ ] Pass |
| Memory Fragmentation | Low | Endurance | [ ] Pass |
| Connection Pool Health | Stable | All | [ ] Pass |

---

## Expected Behavior

### Happy Path Scenario - Expected Results

**Ramp-up Phase (0-4 minutes)**:
- Response times start high (empty caches)
- Error rate low (no contention)
- Throughput increases linearly with VU count
- Memory usage grows initially

**Steady State (4-9 minutes)**:
- Response times stabilize
- Error rate remains < 1%
- Consistent throughput at 100 VUs
- Memory usage plateaus

**Ramp-down (9-10 minutes)**:
- Response times drop sharply
- Throughput decreases
- Memory gradually releases

**Expected metrics**:
- Average response time: 200-400ms
- p95: 800-1500ms
- p99: 1200-2000ms
- Throughput: 150-250 req/sec

### Stress Test - Expected Results

**Ramp-up (0-30 seconds)**:
- Response times acceptable
- No errors yet
- Load increasing linearly

**Spike (30-90 seconds)**:
- Response times increase (degradation expected)
- Some rate limiting kicks in (429 errors)
- System remains responsive
- Errors may spike to 2-5%

**Recovery**:
- Once load decreases, system recovers quickly
- No hanging requests
- No crash or restart

**Expected metrics**:
- p95 may reach 3000-5000ms during spike
- Error rate: 2-5% acceptable
- System should recover to baseline within 30 seconds of load decrease

### Endurance Test - Expected Results

**Phase 1 (0-1 minute)**:
- Memory usage grows as VUs ramp up
- Response times initially high

**Phase 2 (1-16 minutes)**:
- Memory should stabilize after initial growth
- Response times should remain consistent
- No degradation over time
- Garbage collection should prevent unbounded growth

**Memory snapshot analysis**:
- Initial: ~60-80MB heap used
- Stabilized: ~80-100MB heap used
- Growth rate: Should be < 1MB/min
- No memory leak if growth < 20% over 15 minutes

---

## Monitoring During Tests

### Real-time Monitoring Commands

**Terminal 1 - Run Tests**:
```bash
cd qr-access-backend
SCENARIO="happy-path" node load-test-runner.js
```

**Terminal 2 - Monitor Results Directory**:
```bash
watch 'ls -lah load-test-results/ && echo "---" && tail -f /tmp/backend.log | head -20'
```

**Terminal 3 - Monitor Backend Process**:
```bash
# macOS
top -p $(pgrep -f "npm start" | head -1)

# Linux
ps aux | grep "npm start" && free -h
```

**Terminal 4 - Monitor Database**:
```bash
while true; do
  echo "=== $(date) ==="
  du -h access.db 2>/dev/null || echo "DB not found"
  lsof | grep access.db | head -5
  sleep 5
done
```

### Metrics to Watch During Tests

**If p95 > 2000ms**:
- Check database file size: `du -h access.db`
- Check process memory: `ps aux | grep node`
- Check open connections: `lsof | grep node`

**If error rate > 1%**:
- Check for 429 rate limit errors in results
- Check for 500 server errors in backend logs
- Check database connectivity

**If memory grows unbounded**:
- Check for specific endpoints causing growth
- Review open file descriptors: `lsof | grep node | wc -l`
- Check for event listener leaks

---

## Post-Test Analysis Checklist

After each scenario completes:

- [ ] Check results JSON for validity
- [ ] Verify all metrics collected
- [ ] Identify any errors or anomalies
- [ ] Compare against success criteria
- [ ] Document findings in separate report
- [ ] Check backend logs for errors
- [ ] Note any resource spikes

### Immediate Post-Test Steps

```bash
# View results
ls -lh load-test-results/
cat load-test-results/happy-path-*.json | jq '.results | keys'

# Extract key metrics
cat load-test-results/happy-path-*.json | jq '.results.endpointStats | to_entries | .[] | {endpoint: .key, p95: .value.p95, errors: .value.errors}'

# Check for errors
grep -i error /tmp/backend.log | tail -20
```

---

## Troubleshooting During Tests

### Issue: Tests Hang or Freeze

**Symptoms**: Load test not making progress, response times stuck

**Possible Causes**:
1. Database locked by SQLite
2. Node.js event loop blocked
3. Network connectivity issue

**Debug**:
```bash
# Check process status
ps aux | grep node

# Check database status
lsof | grep access.db

# Kill and restart
pkill -f "npm start"
npm start
```

### Issue: Memory Grows Too Quickly

**Symptoms**: Heap used > 200MB in < 5 minutes

**Possible Causes**:
1. Unbounded cache in memory
2. Memory leak in request handling
3. Array/object accumulation

**Debug**:
```bash
# Enable profiling
node --prof load-test-runner.js

# Check memory during run
node --inspect load-test-runner.js
# Open chrome://inspect in Chrome DevTools
```

### Issue: Database Size Explodes

**Symptoms**: access.db grows to GB size during test

**Likely Cause**: Audit logging creating millions of records

**Check**:
```bash
sqlite3 access.db "SELECT COUNT(*) FROM audit_logs;"
sqlite3 access.db "SELECT COUNT(*) FROM members;"
```

---

## Results Interpretation

### Response Time Metrics

```
p50 (Median): 50% of users experience this or better
p95 (95th percentile): Only 5% experience slower
p99 (99th percentile): Only 1% experience even slower
```

**Good Pattern**:
- p50: 100-300ms
- p95: 500-2000ms
- p99: 1000-3000ms

**Poor Pattern**:
- p50: > 1000ms (baseline too slow)
- p95: > 2000ms (worst experience too bad)
- p99: > 5000ms (outliers extremely slow)

### Throughput Analysis

**Measured**: X req/sec across all VUs

**Interpretation**:
- 100 VUs × 15 req/min = 25 req/sec minimum
- Actual throughput should be 150-250 req/sec (6-10x)
- If less, bottleneck exists

### Error Rate Analysis

**< 0.5%**: Excellent - production ready
**0.5-1%**: Good - acceptable
**1-2%**: Fair - investigate before production
**> 2%**: Poor - needs optimization

---

## Documentation After Tests

### Required Deliverables

1. **JSON Results Files**
   - Location: `load-test-results/*.json`
   - Content: Raw metrics for analysis
   - Keep for: 30 days minimum

2. **Performance Report**
   - What to include:
     - Summary statistics
     - Response time distribution
     - Error breakdown
     - Throughput analysis
     - Memory usage trends
     - Success criteria validation

3. **Bottleneck Analysis**
   - Identify slow endpoints
   - Highlight error patterns
   - Spot memory issues
   - Note rate limiting effects

4. **Recommendations**
   - Optimization opportunities
   - Scaling strategy
   - Monitoring setup
   - Production readiness assessment

---

## Next Steps

### If All Criteria Pass

1. ✓ Lock in test configuration
2. ✓ Document performance baseline
3. ✓ Set up production monitoring (same metrics)
4. ✓ Plan Phase 4: Security Testing
5. ✓ Proceed to production deployment

### If Some Criteria Fail

1. Identify bottleneck
2. Optimize that component
3. Re-run that scenario
4. Validate fix
5. Document root cause and solution

### If Critical Criteria Fail

1. Halt production plan
2. Deep analysis (profiling, debugging)
3. Major optimization (architecture change?)
4. Re-test after changes
5. Consider scaling out (multiple instances)

---

## Reference Materials

- **Load Test Runner**: `load-test-runner.js` (Node.js HTTP client)
- **K6 Script**: `load-test.js` (alternative sophisticated testing)
- **Orchestration**: `run-load-tests.sh` (automate all scenarios)
- **Documentation**: `LOAD_TEST.md` (detailed guide)
- **Backend**: `server.js`, `controllers/qrController.js`
- **Database**: `utils/database.js`

---

## Approval & Sign-off

**Test Plan Reviewed**: [ ] _______________
**Test Plan Approved**: [ ] _______________
**Tests Executed**: [ ] _______________
**Results Analyzed**: [ ] _______________
**Production Ready**: [ ] _______________

