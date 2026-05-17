# SIDEON QR Access Control Backend - Phase 1

Express.js backend for SIDEON's QR-based access control system with secure token generation, verification, and check-in tracking.

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
├── models/               # Database models (Phase 2+)
├── middleware/           # Express middleware (Phase 2+)
├── utils/                # Helper utilities
│   ├── database.js       # SQLite setup
│   └── tokenGenerator.js # Secure token generation
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
- `JWT_SECRET`: For future authentication (Phase 2+)

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

### Tokens Table
```sql
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  member_id VARCHAR(50) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  created_at DATETIME,
  verified_at DATETIME,
  checked_in_at DATETIME,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
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
  "message": "QR token generated successfully"
}
```

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
    "verified_at": null,
    "checked_in_at": null,
    "is_checked_in": false
  }
}
```

**Error Responses:**
- `400 Bad Request`: Missing token parameter
- `404 Not Found`: Invalid token format or token not found
- `500 Internal Server Error`: Database error

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
  "checked_in_at": "2026-05-17T10:35:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Missing token
- `404 Not Found`: Token not found
- `409 Conflict`: Token already checked in (duplicate prevention)
- `500 Internal Server Error`: Database error

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
  "verified_at": "2026-05-17T10:35:00Z",
  "checked_in_at": "2026-05-17T10:35:00Z",
  "is_checked_in": true
}
```

**Error Responses:**
- `400 Bad Request`: Missing token parameter
- `404 Not Found`: Token not found
- `500 Internal Server Error`: Database error

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
| 400 | Bad Request | Missing/invalid parameters |
| 404 | Not Found | Token/endpoint not found |
| 409 | Conflict | Duplicate check-in attempted |
| 500 | Server Error | Database or internal error |

---

## Logging

Console logs include:
- Token generation: `[TOKEN]`
- Check-ins: `[CHECK-IN]`
- Database errors: `[DB ERROR]`
- General errors: `[ERROR]`

Example:
```
[TOKEN] Generated token for member 00147: SIDN_EVENT_2026_M00147_xyz7k9q...
[CHECK-IN] Token verified: SIDN_EVENT_2026_M00147_xyz7k9q... for member 00147
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

## Next Steps (Phase 2+)

- JWT authentication for API endpoints
- QR code image generation (qrcode library)
- API rate limiting
- Request validation middleware
- Comprehensive logging system
- Unit & integration tests
- API versioning
- Frontend integration

---

## License

ISC

---

## Status

✅ Backend skeleton + token generation ready. Awaiting QA feedback.
