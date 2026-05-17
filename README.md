# SIDEON QR Access Control Backend - Phase 2

Express.js backend for SIDEON's QR-based access control system with secure token generation, verification, and check-in tracking. Phase 2 adds token expiration, parameterized queries, audit logging, and rate limiting.

## Architecture

```
qr-access-backend/
├── server.js              # Main Express app
├── .env                   # Environment variables
├── .env.example          # Template for .env
├── package.json          # Dependencies
├── controllers/          # Request handlers
│   └── qrController.js   # QR token & check-in logic
├── routes/               # API endpoints
│   ├── qrRoutes.js       # QR operations
│   └── healthRoutes.js   # Health checks
├── models/               # Database models
├── middleware/           # Express middleware
│   └── rateLimiter.js    # Rate limiting (Phase 2)
├── utils/                # Helper utilities
│   ├── database.js       # SQLite setup + migration
│   ├── tokenGenerator.js # Secure token generation
│   ├── auditLogger.js    # Audit trail logging (Phase 2)
│   └── migrate.js        # Database migration (Phase 2)
├── data/                 # Database files (created at runtime)
└── tests/                # Demo & test scripts
    └── demo.js           # Comprehensive test suite
```

## Setup

### Prerequisites
- Node.js 14+
- npm

### Installation

```bash
cd qr-access-backend
npm install
```

### Configuration

Copy `.env.example` to `.env` and adjust settings:

```bash
cp .env.example .env
```

Key variables:
- `NODE_ENV`: Set to `development` or `production`
- `PORT`: Server port (default: 3001)
- `DATABASE_URL`: SQLite database path
- `EXPIRATION_MINUTES`: Token expiration window in minutes (default: 60, Phase 2)

### Running the Server

```bash
# Development
npm run dev

# Production
npm start
```

Server will listen on `http://localhost:3001`

## Database Schema

### Members Table
```sql
CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  member_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  mobile VARCHAR(20),
  agent VARCHAR(255),
  created_at DATETIME,
  updated_at DATETIME
)
```

### Tokens Table (Phase 2)
```sql
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  member_id VARCHAR(50) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  created_at DATETIME,
  expiresAt DATETIME NOT NULL,
  verified_at DATETIME,
  checked_in_at DATETIME,
  scan_count INTEGER DEFAULT 0,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
)
```

### Audit Logs Table (Phase 2)
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  operation VARCHAR(50) NOT NULL,
  member_id VARCHAR(50),
  token_id VARCHAR(255),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20),
  error_code INTEGER,
  ip_address VARCHAR(45),
  metadata JSON
)
```

## API Endpoints

### 1. Generate QR Token
**POST** `/api/generate-qr`

Generate a secure QR access token for a member.

**Request Body:**
```json
{
  "member_id": "00147",
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "+1-555-0123",
  "agent": "Agent Name"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "token": "SIDN_EVENT_2026_M00147_abc123def456",
  "member_id": "00147",
  "created_at": "2026-05-17T10:30:00Z",
  "expiresAt": "2026-05-17T11:30:00Z",
  "expirationMinutes": 60,
  "message": "QR token generated successfully"
}
```

**Phase 2 Enhancements:**
- Token includes `expiresAt` timestamp (configurable via `EXPIRATION_MINUTES` env var)
- All queries use parameterized statements (SQL injection protection)
- Audit logging tracks all token generation events

**Error Responses:**
- `400 Bad Request`: Missing required fields
- `500 Internal Server Error`: Database or generation error

---

### 2. Verify Token
**GET** `/api/verify?token=SIDN_EVENT_2026_M00147_abc123def456`

Verify a token and retrieve member information.

**Response (200 OK):**
```json
{
  "success": true,
  "token": "SIDN_EVENT_2026_M00147_abc123def456",
  "member": {
    "id": "00147",
    "name": "John Doe",
    "email": "john@example.com",
    "mobile": "+1-555-0123",
    "agent": "Agent Name"
  },
  "token_status": {
    "created_at": "2026-05-17T10:30:00Z",
    "expiresAt": "2026-05-17T11:30:00Z",
    "verified_at": null,
    "checked_in_at": null,
    "is_checked_in": false,
    "scan_count": 0
  }
}
```

**Error Responses:**
- `400 Bad Request`: Missing token parameter or invalid format
- `404 Not Found`: Token not found
- `410 Gone`: Token has expired
- `500 Internal Server Error`: Database error

**Phase 2 Enhancements:**
- Checks token expiration (`expiresAt` vs CURRENT_TIMESTAMP)
- Returns `scan_count` for rate tracking
- Audit logging tracks all verification attempts

---

### 3. Check-In (Mark Verified)
**POST** `/api/check-in`

Mark a token as verified and log the check-in timestamp.

**Request Body:**
```json
{
  "token": "SIDN_EVENT_2026_M00147_abc123def456"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Check-in successful",
  "token": "SIDN_EVENT_2026_M00147_abc123def456",
  "member_id": "00147",
  "verified_at": "2026-05-17T10:35:00Z",
  "checked_in_at": "2026-05-17T10:35:00Z",
  "scan_count": 1
}
```

**Error Responses:**
- `400 Bad Request`: Missing token or invalid format
- `404 Not Found`: Token not found
- `409 Conflict`: Token already checked in (duplicate prevention)
- `410 Gone`: Token has expired
- `429 Too Many Requests`: Rate limit exceeded (max 10 requests/minute per member)
- `500 Internal Server Error`: Database error

**Rate Limiting Headers:**
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1234567890
Retry-After: 60
```

**Phase 2 Enhancements:**
- Validates token expiration before check-in
- Prevents duplicate check-ins with atomic UPDATE (race condition protection)
- Rate limiting: max 10 requests/minute per member
- Returns `verified_at`, `checked_in_at`, and `scan_count`
- Audit logging tracks all check-in attempts (success/failure)
- Transaction-like behavior prevents concurrent check-in races

---

### 4. Check-In Status
**GET** `/api/check-in-status?token=SIDN_EVENT_2026_M00147_abc123def456`

Check if a token has been verified/checked-in.

**Response (200 OK):**
```json
{
  "success": true,
  "token": "SIDN_EVENT_2026_M00147_abc123def456",
  "member_id": "00147",
  "created_at": "2026-05-17T10:30:00Z",
  "expiresAt": "2026-05-17T11:30:00Z",
  "is_expired": false,
  "verified_at": "2026-05-17T10:35:00Z",
  "checked_in_at": "2026-05-17T10:35:00Z",
  "is_checked_in": true,
  "scan_count": 3
}
```

**Error Responses:**
- `400 Bad Request`: Missing token parameter or invalid format
- `404 Not Found`: Token not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Database error

**Phase 2 Enhancements:**
- Returns `expiresAt` and `is_expired` status
- Includes `scan_count` for tracking verification attempts
- Audit logging tracks all status check requests

---

### 5. Health Check
**GET** `/api/health` or **GET** `/health`

Server health status.

**Response (200 OK):**
```json
{
  "status": "OK",
  "service": "SIDEON QR Access Control Backend",
  "timestamp": "2026-05-17T10:30:00Z",
  "uptime": 125.45
}
```

---

## Token Format & Security

### Token Structure
```
SIDN_EVENT_2026_M{MEMBER_ID}_{RANDOM_12_BYTES}
```

Example:
```
SIDN_EVENT_2026_M00147_a1b2c3d4e5f6g7h8i9j0k1l2
```

### Security Properties
- **No plaintext member data** embedded in token
- **Cryptographically secure random bytes** (12 bytes = 24 hex chars)
- **Unique per generation** - even same member gets different token each time
- **Format validation** prevents invalid tokens from being processed
- **Database indexed** for fast lookups

---

## Testing

Run the comprehensive demo suite:

```bash
npm test
```

This will:
1. Generate a secure token
2. Validate token format
3. Test database operations
4. Verify member/token storage
5. Test token lookup
6. Simulate check-in workflow
7. Verify duplicate prevention

Expected output:
```
✓ ALL TESTS PASSED - PHASE 1 READY
✓ Backend skeleton + token generation ready.
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Descriptive error message",
  "status": 400
}
```

### HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful request |
| 201 | Created | Token/member created |
| 400 | Bad Request | Missing/invalid parameters or format |
| 404 | Not Found | Token/endpoint not found |
| 409 | Conflict | Duplicate check-in attempted |
| 410 | Gone | Token has expired (Phase 2) |
| 422 | Unprocessable | Token invalid/failed validation (Phase 2) |
| 429 | Too Many Requests | Rate limit exceeded (Phase 2) |
| 500 | Server Error | Database or internal error |

---

## Logging & Audit Trail (Phase 2)

### Console Logs
- Token generation: `[TOKEN]`
- Check-ins: `[CHECK-IN]`
- Database errors: `[DB ERROR]`
- Audit operations: `[AUDIT]`
- General errors: `[ERROR]`

Example:
```
[TOKEN] Generated token for member 00147: SIDN_EVENT_2026_M00147_xyz7k9q...
[CHECK-IN] Success: token=SIDN_EVENT_2026_M00147_xyz7k9q... member=00147
[AUDIT] Old logs cleaned (90+ days)
```

### Audit Logging (Phase 2)
All token operations are logged to `audit_logs` table:
- **generate**: Token creation with expiration
- **verify_attempt**: Token verification (success/failure)
- **check_in**: Check-in requests (success/failure)
- **status_check**: Status inquiries

Log retention: 90 days (automatic daily cleanup)

Example audit log entry:
```json
{
  "operation": "check_in",
  "member_id": "00147",
  "token_id": "SIDN_EVENT_2026_M00147_...",
  "timestamp": "2026-05-17T10:35:00Z",
  "status": "success",
  "error_code": null,
  "ip_address": "192.168.1.100",
  "metadata": {
    "checkedInAt": "2026-05-17T10:35:00Z",
    "scanCount": 1
  }
}
```

---

## Phase 1 Deliverables

- [x] Express.js project initialized
- [x] Environment configuration (.env)
- [x] Database schema (SQLite)
- [x] Secure token generation (crypto.randomBytes)
- [x] 5 API endpoints with error handling
- [x] Member & token storage
- [x] Check-in workflow with duplicate prevention
- [x] Comprehensive test suite
- [x] API documentation

---

## Phase 2 Deliverables (COMPLETE)

### Security & Data Protection
- [x] Token expiration validation (configurable window)
- [x] Parameterized queries (100% SQL injection protection)
- [x] Race condition prevention (atomic UPDATE with WHERE check)
- [x] Duplicate detection (409 Conflict response)

### Observability & Compliance
- [x] Audit logging middleware (all operations tracked)
- [x] Audit logs table with 90-day retention
- [x] Daily automatic cleanup of old logs
- [x] IP address tracking in audit logs
- [x] Metadata JSON support for detailed logging

### API Reliability
- [x] Rate limiting (10 req/min per member, 5 failures/min per IP)
- [x] Enhanced error responses (400/404/409/410/422/429/500)
- [x] Rate-Limit headers (X-RateLimit-Limit, Remaining, Reset)
- [x] Retry-After header for 429 responses

### Database Enhancements
- [x] expiresAt timestamp column
- [x] scan_count tracking column
- [x] audit_logs table with indexes
- [x] Database migration utility (handles existing databases)
- [x] Transaction-like behavior for check-in

### Testing & Documentation
- [x] Phase 2 test suite (9 comprehensive tests)
- [x] Token expiration test
- [x] Parameterized query validation
- [x] Rate limiting tests
- [x] Audit logging verification
- [x] Concurrent operation handling
- [x] Updated API documentation with Phase 2 features
- [x] README with error codes and rate-limit headers

---

## Next Steps (Phase 3+)

- JWT authentication for API endpoints
- QR code image generation (qrcode library)
- Advanced analytics from audit logs
- Unit & integration tests (Jest)
- API versioning (v1, v2)
- PostgreSQL migration (production database)
- Frontend integration with rate-limit handling
- Load testing and performance tuning

---

## License

ISC

---

## Status

✅ Backend skeleton + token generation ready. Awaiting QA feedback.
