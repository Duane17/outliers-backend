# Outliers auth session and cookie contract

This document defines how user sessions are represented and shared across:

- Marketing frontend: `outliers-frontend`  
- Dashboard frontend: `outliers-dashboard`  
- Backend API: `outliers-backend`

The goal is a single sign in experience backed by an httpOnly cookie that both frontends can rely on.

---

## 1. Token format

We use a JWT as the session token.

- Format: signed JWT (HS256)
- Secret: `JWT_SECRET` from environment
- Issuer: `JWT_ISSUER` from environment
- Lifetime: `JWT_ACCESS_TTL` from environment

### 1.1 JWT claims

Minimal claims:

```json
{
  "sub": "<user-id>",
  "iss": "<JWT_ISSUER>",
  "iat": 1234567890,
  "exp": 1234567890,
  "role": "<role-slug>",
  "email": "user@example.com"
}

sub

Required

String user id from the database

iss

Required

Must equal JWT_ISSUER

iat

Issued at, numeric unix timestamp

exp

Expiry, numeric unix timestamp

Computed as iat + JWT_ACCESS_TTL

role

Optional but recommended

Example: admin, member

email

Optional

Included for convenience on the frontend but not trusted for access control

The backend always treats sub as the source of truth for identity and uses that to load the user record.

2. Session cookie

The JWT is stored in a single httpOnly cookie. Frontends never read the raw token.

Cookie name: outliers_session

Value: the JWT described above

2.1 Attributes

Prod defaults:

Domain=.outliersmw.com

Path=/

HttpOnly=true

Secure=true (HTTPS only)

SameSite=Lax

Dev defaults:

When using plain localhost origins, cookie domain will default to localhost

When using host aliases (outliersmw.com, dashboard.outliersmw.com, api.outliersmw.com mapped to 127.0.0.1), domain will be .outliersmw.com

The same cookie name and semantics are used in both environments. Only Domain and Secure differ.

2.2 Lifetime and refresh strategy

Session lifetime is controlled by JWT_ACCESS_TTL

Example values:

"8h" for a typical work day session

"24h" for a longer lived session in dev

There is no refresh token for v1

When the JWT expires, the session is considered invalid

Frontends will redirect the user back to the marketing auth page to sign in again

Idle timeout

For v1, the JWT expiry is absolute

There is no sliding expiration or activity based extension

Future versions can add a refresh token and sliding expiry without changing the cookie name.

3. Endpoint behavior
3.1 POST /v1/auth/login

Input: credentials (email and password) in JSON

Behavior:

Validate credentials

If valid:

Create JWT with claims described above

Return 200 OK with a minimal user JSON body

Send Set-Cookie: outliers_session=<jwt>; HttpOnly; SameSite=Lax; Domain=...

If invalid:

Return 401 Unauthorized with a generic error message

Do not set a cookie

Clients:

Marketing frontend calls this endpoint from /auth with credentials: "include"

Dashboard should not call login directly in v1

3.2 GET /v1/auth/me

Input: no body

Reads outliers_session cookie only

Behavior:

If cookie is missing or invalid:

Return 401 Unauthorized

If cookie is valid:

Load user from database using sub

Return 200 OK with user JSON

Response shape (baseline):

{
  "id": "<user-id>",
  "email": "user@example.com",
  "name": "User Name",
  "role": "admin",
  "createdAt": "2025-01-01T00:00:00.000Z"
}


Clients:

Dashboard uses this endpoint on initial load to resolve the current user

Marketing site does not need it for v1

3.3 POST /v1/auth/logout

Input: no body

Reads outliers_session cookie

Behavior:

If cookie exists:

Optionally revoke or blacklist the token server side (implementation detail)

Send Set-Cookie with outliers_session cleared and expired

Return 200 OK with { "success": true }

Clients:

Dashboard calls this endpoint from the user menu Logout action

Marketing does not call logout directly

4. Frontend expectations
4.1 Marketing frontend (outliers-frontend)

Calls POST /v1/auth/login from /auth

Uses credentials: "include" so cookies are set

On success, redirects to dashboard base URL

Does not store tokens in localStorage or sessionStorage

May later pass a next query parameter so the dashboard can deep link after successful auth

4.2 Dashboard frontend (outliers-dashboard)

On initial load:

Calls GET /v1/auth/me with credentials: "include"

If 200:

Stores user in auth context and renders dashboard

If 401:

Redirects to marketing auth: /auth?next=<current-path>

For logout:

Calls POST /v1/auth/logout with credentials: "include"

Clears local auth state

Redirects to marketing auth page

5. Error handling and security notes

Login errors must be generic

Example: "Invalid email or password"

Never reveal whether the email exists

Auth middleware must:

Accept only tokens with the correct iss

Reject tokens that are expired

Treat any decode or signature failure as unauthenticated

CORS must allow credentials for:

Dev: http://localhost:3000 and http://localhost:3001 or the local host aliases

Prod: https://outliersmw.com and https://dashboard.outliersmw.com

All stateful authentication for human users goes through the outliers_session cookie

API keys remain separate and use the existing API key mechanism