# SIDEON QR Access Control - Phase 2 Test Plan

**Status:** In Progress
**Date:** 2026-05-17
**QA Lead:** Claude Code QA Specialist
**Test Framework:** Jest + Supertest
**Target Coverage:** 70%+

---

## Executive Summary

Phase 2 testing focuses on comprehensive validation of the QR access control system with unit tests, integration tests, and manual test scenarios covering happy paths, error states, and edge cases.

---

## Test Strategy

### Test Pyramid
```
         /\
        /E2E\      <- Manual workflows, performance, mobile
       /------\
      /Integr. \   <- API endpoints, error handling, workflows
     /----------\
    /   Unit     \ <- Token generation, validation, utilities
   /--------------\
```

### Test Coverage Targets
- **Unit Tests:** 70%+ statement coverage
- **Integration Tests:** All 5 API endpoints + error cases
- **Manual Tests:** 15+ scenarios covering workflows, devices, accessibility
- **Performance:** <2s QR scan, <1s API response, <500ms render
- **Regression:** Phase 1 APIs unchanged

---

## Part 1: Unit Tests (`__tests__/unit.test.js`)

### Test Categories

#### 1. Token Generation (`generateToken()`)
| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Generate token with valid member ID | Token matches format `SIDN_EVENT_2026_M{ID}_{24_hex_chars}` | Pending |
| Generate unique tokens for same member | Two calls produce different tokens | Pending |
| Handle different member IDs | Tokens contain correct member ID | Pending |
| Consistent token length | All tokens have length ≥ 35 characters | Pending |
| Reject null member ID | Throw "Invalid member ID" error | Pending |
| Reject undefined member ID | Throw "Invalid member ID" error | Pending |
| Reject non-string member ID | Throw "Invalid member ID" error | Pending |
| Reject empty string member ID | Throw "Invalid member ID" error | Pending |

#### 2. Token Format Validation (`validateTokenFormat()`)
| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Valid token format | Return `true` | Pending |
| Invalid prefix | Return `false` | Pending |
| Invalid year (2025 instead of 2026) | Return `false` | Pending |
| Missing member ID | Return `false` | Pending |
| Invalid random section (non-hex) | Return `false` | Pending |
| Too short random section | Return `false` | Pending |
| Null/undefined token | Return `false` | Pending |
| Empty string token | Return `false` | Pending |

#### 3. Member ID Extraction (`extractMemberIdFromToken()`)
| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Extract ID from valid token | Return correct member ID | Pending |
| Extract different member IDs | Return correct IDs for each | Pending |
| Invalid token format | Return `null` | Pending |
| Null/undefined token | Return `null` | Pending |

#### 4. Edge Cases & Security
| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Token randomness (100 iterations) | All tokens unique | Pending |
| Single digit member ID | Token valid and usable | Pending |
| Long numeric member ID | Token valid and usable | Pending |
| SQL injection in member ID | Throw error or reject | Pending |
| XSS payload in member ID | Throw error or reject | Pending |

---

## Part 2: Integration Tests (`__tests__/integration.test.js`)

### Test Categories

#### 1. POST /api/generate-qr
| Test Case | Input | Expected | Status |
|-----------|-------|----------|--------|
| Valid request with all fields | member_id, name, email, mobile, agent | HTTP 201, token generated | Pending |
| Valid request (required fields only) | member_id, name | HTTP 201, token generated | Pending |
| Missing member_id | name, email, mobile, agent | HTTP 400, "member_id required" | Pending |
| Missing name | member_id, email, mobile, agent | HTTP 400, "name required" | Pending |
| Empty request body | {} | HTTP 400, validation error | Pending |
| Unique tokens for same member | Generate twice | Tokens are different | Pending |

#### 2. GET /api/verify
| Test Case | Input | Expected | Status |
|-----------|-------|----------|--------|
| Valid token | token=SIDN_... | HTTP 200, member data, is_checked_in=false | Pending |
| Missing token parameter | (no param) | HTTP 400, "token required" | Pending |
| Invalid token format | token=INVALID | HTTP 404, "Invalid token format" | Pending |
| Non-existent token | token=SIDN_...invalid | HTTP 404, "Token not found" | Pending |

#### 3. POST /api/check-in
| Test Case | Input | Expected | Status |
|-----------|-------|----------|--------|
| Valid token | token=SIDN_... | HTTP 200, "Check-in successful" | Pending |
| Missing token | {} | HTTP 400, "token required" | Pending |
| Invalid token format | token=INVALID | HTTP 404, "Invalid token format" | Pending |
| Non-existent token | token=SIDN_...invalid | HTTP 404, "Token not found" | Pending |
| Duplicate check-in | Check-in same token twice | First: HTTP 200, Second: HTTP 409 | Pending |

#### 4. GET /api/check-in-status
| Test Case | Input | Expected | Status |
|-----------|-------|----------|--------|
| Unchecked-in token | token=SIDN_... | HTTP 200, is_checked_in=false | Pending |
| Checked-in token | token=SIDN_... | HTTP 200, is_checked_in=true, timestamp | Pending |
| Missing token | (no param) | HTTP 400, "token required" | Pending |
| Invalid format | token=INVALID | HTTP 404, "Invalid format" | Pending |
| Non-existent token | token=SIDN_...invalid | HTTP 404, "Token not found" | Pending |

#### 5. GET /api/health
| Test Case | Input | Expected | Status |
|-----------|-------|----------|--------|
| Health check | (no param) | HTTP 200, status="OK", timestamp | Pending |

#### 6. Complete Workflow
| Test Case | Steps | Expected | Status |
|-----------|-------|----------|--------|
| Full check-in workflow | 1. Generate 2. Verify 3. Check-in 4. Verify status | All succeed, member verified | Pending |

#### 7. HTTP Status Codes
| Code | Scenario | Status |
|------|----------|--------|
| 200 | Successful check-in, verify, status | Pending |
| 201 | Token generated | Pending |
| 400 | Missing/invalid parameters | Pending |
| 404 | Token not found, invalid format | Pending |
| 409 | Duplicate check-in | Pending |
| 500 | Database/server error | Pending |

---

## Part 3: Manual Test Scenarios (15+)

### Happy Path
1. **Basic Check-In Flow**
   - Generate QR token
   - Scan/verify token
   - Perform check-in
   - Confirm "Check-in successful" message
   - Expected: Member verified with timestamp

2. **Multiple Member Check-In**
   - Generate 5 different member tokens
   - Check in each member in sequence
   - Verify each has unique check-in timestamp
   - Expected: All 5 members checked in successfully

3. **Concurrent Check-Ins**
   - Generate 10 member tokens
   - Perform check-ins simultaneously (or rapid sequence)
   - Verify all complete without errors
   - Expected: No race conditions, all successful

### Error States
4. **Invalid Token Format**
   - Input malformed token (not SIDN_EVENT_...)
   - Expected: "Invalid token format" error

5. **Token Not Found (404)**
   - Input valid-format but non-existent token
   - Expected: "Member not found" message

6. **Already Verified (409)**
   - Check-in same token twice
   - Expected: "Already verified" + original timestamp

7. **Server Error Recovery**
   - Simulate database unavailability
   - Expected: "Server error, try again" + retry button

8. **Network Timeout**
   - Throttle network to <1 Mbps, trigger long request
   - Expected: "Connection lost" + retry capability

### Edge Cases
9. **Empty Input**
   - Submit empty/blank token field
   - Expected: "Token required" validation error

10. **Token Expiration** (Phase 2 enhancement)
    - Wait for token to expire (if implemented)
    - Expected: "Token expired" message

11. **Special Characters in Member Data**
    - Member name with unicode: "José", "李明"
    - Expected: Properly stored and displayed

12. **Long Token**
    - Generate token, verify exact format
    - Expected: Consistent 47-char length

13. **Case Sensitivity**
    - Input lowercase vs. uppercase token portion
    - Expected: Format validation enforces uppercase for prefix

14. **Rapid Token Generation**
    - Generate 100 tokens in sequence
    - Expected: All unique, no duplicates

15. **Database State Consistency**
    - After check-in, query database directly
    - Expected: `checked_in_at` timestamp recorded

### Accessibility (WCAG 2.1 AA)
16. **Keyboard Navigation**
    - Tab through all form fields (input, submit, buttons)
    - Expected: All elements reachable via keyboard

17. **Screen Reader Support**
    - Test with screen reader (VoiceOver, NVDA)
    - Expected: Form labels, messages, button purposes clear

18. **Color Contrast**
    - Measure text color contrast ratio
    - Expected: 4.5:1 minimum for normal text

19. **Alt Text for QR Code**
    - If QR image displayed, check alt attribute
    - Expected: Descriptive alt text present

20. **Error Message Accessibility**
    - Error text associated with form fields
    - Expected: Screen readers announce field errors

### Mobile & Responsive (WCAG 2.1 Mobile)
21. **Mobile Portrait (320px)**
    - Render on 320px width device
    - Expected: Text readable, buttons tappable (48px+), no horizontal scroll

22. **Mobile Landscape (480px)**
    - Rotate to landscape
    - Expected: Layout adjusts, all content visible

23. **Tablet (768px)**
    - Test on tablet resolution
    - Expected: Form fields properly sized

24. **Touch Targets**
    - All buttons/links ≥ 48px × 48px
    - Expected: No mis-taps on mobile

25. **Camera Permission (if QR scanning)**
    - Deny camera permission
    - Expected: Helpful message + fallback input option

### Performance Validation
26. **QR Scan Detection** (<2s)
    - Time from scan initiation to token extraction
    - Expected: <2000ms

27. **API Response Time** (<1s)
    - Time from `/check-in` POST to response
    - Expected: <1000ms

28. **Page Load** (<500ms)
    - Load check-in page
    - Expected: Interactive in <500ms

29. **No Console Errors**
    - Open DevTools, perform check-in
    - Expected: No errors in console

30. **Memory Leaks**
    - Run profile, perform 100 check-ins
    - Force GC, check memory delta
    - Expected: No heap growth

### Browser & Device Matrix
31. **Chrome Desktop** (latest)
    - Full workflow on Chrome
    - Expected: All features work

32. **Safari Desktop** (latest)
    - Full workflow on Safari
    - Expected: All features work

33. **Firefox Desktop** (latest)
    - Full workflow on Firefox
    - Expected: All features work

34. **iOS Safari** (latest)
    - Full workflow on iOS device
    - Expected: Touch, camera, notifications work

35. **Android Chrome** (latest)
    - Full workflow on Android device
    - Expected: Camera, permissions, notifications work

### Regression Testing
36. **Phase 1 Health Check API**
    - Call `/api/health` endpoint
    - Expected: Status 200, "OK" response

37. **Phase 1 Token Generation**
    - Call existing `/api/generate-qr` endpoint
    - Expected: Works unchanged

38. **Phase 1 Database Queries**
    - Verify member/token tables unchanged
    - Expected: Schema, indexes intact

---

## Test Execution Plan

### Unit Tests (Jest)
```bash
npm test
# Runs all __tests__/*.test.js files
# Target: Pass 100%, coverage ≥ 70%
```

### Integration Tests (Jest + Supertest)
```bash
npm test -- __tests__/integration.test.js
# Tests all API endpoints with real app instance
# Target: Pass 100%
```

### Test Coverage Report
```bash
npm run test:coverage
# Generates coverage/index.html
# Target: ≥ 70% statements, branches, functions, lines
```

### Manual Testing
- Test scenarios 1-38 (documented above)
- Test on browsers: Chrome, Safari, Firefox (latest)
- Test on devices: iOS, Android (landscape & portrait)
- Test accessibility with WAVE, Axe, or VoiceOver
- Test performance with Chrome DevTools Throttling

---

## Success Criteria

| Criterion | Target | Status |
|-----------|--------|--------|
| Unit test pass rate | 100% | Pending |
| Integration test pass rate | 100% | Pending |
| Code coverage | ≥ 70% | Pending |
| Manual test scenarios | ≥ 15 passed | Pending |
| WCAG 2.1 AA compliance | 100% | Pending |
| QR scan detection time | <2s | Pending |
| API response time | <1s | Pending |
| Page load time | <500ms | Pending |
| Critical bugs | 0 | Pending |
| High priority bugs | 0 | Pending |
| Regression tests | 0 failures | Pending |
| Browser coverage | Chrome, Safari, Firefox | Pending |
| Mobile coverage | iOS, Android | Pending |

---

## Bug Tracking Format

**Example Bug Report:**

```
Title: [CRITICAL] Check-in button disabled after timeout
Status: Open
Priority: Critical
Date: 2026-05-17

Description:
After a network timeout, the check-in button remains disabled.

Steps to Reproduce:
1. Throttle network to <1 Mbps (DevTools)
2. Attempt check-in
3. Wait for timeout
4. Button should re-enable

Expected:
Button enables and shows retry option

Actual:
Button remains disabled permanently

Environment:
- Browser: Chrome 131
- Device: macOS
- Network: Throttled 3G
```

---

## Deliverables

1. ✓ `jest.config.js` - Test framework configuration
2. ✓ `__tests__/unit.test.js` - Unit tests for token utilities
3. ✓ `__tests__/integration.test.js` - Integration tests for API endpoints
4. ✓ `test-plan-phase2.md` - This document
5. ⏳ `test-report-phase2.md` - Results after execution
6. ⏳ `coverage/index.html` - Coverage report
7. ⏳ Git commits per milestone (unit → integration → manual → regression)

---

## Git Workflow

### Branch: `feature/phase-2-testing`

**Commits:**
1. `test: add unit test suite for token generation and validation`
2. `test: add integration test suite for API endpoints`
3. `test: add jest configuration and test scripts`
4. `docs: add comprehensive Phase 2 test plan`
5. `test: document manual test scenarios and accessibility requirements`

---

## Timeline

| Phase | Task | Duration | Status |
|-------|------|----------|--------|
| Setup | Install Jest, Supertest, update package.json | 30 min | Done |
| Unit Tests | Write token generation/validation tests | 1 hour | In Progress |
| Integration Tests | Write API endpoint tests | 2 hours | In Progress |
| Manual Tests | Execute 15+ manual scenarios | 2-3 hours | Pending |
| Accessibility | WCAG 2.1 AA compliance check | 1 hour | Pending |
| Performance | Benchmark QR scan, API, page load | 30 min | Pending |
| Report | Compile findings, document bugs | 1 hour | Pending |
| **Total** | **All phases** | **~8 hours** | **In Progress** |

---

## Notes

- Integration tests use temporary test database (`data/test.db`)
- Manual tests should be documented with screenshots
- Performance targets assume standard network conditions (4G/WiFi)
- Accessibility testing uses WCAG 2.1 Level AA as baseline
- All bugs should be logged with reproduction steps

---

## Next Steps (Phase 3+)

- QR code image generation and scanning
- JWT authentication for API endpoints
- Rate limiting and request validation
- Advanced logging and monitoring
- Production deployment and load testing

---

**Status:** Test plan created and ready for execution.
