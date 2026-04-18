# ABZORA Backend

Production backend for ABZORA using:

- Node.js + Express
- MongoDB + Mongoose
- Cloudinary
- Razorpay
- Firebase Auth only
- Redis-backed rate limiting recommended in production

## Setup

1. Copy `.env.example` to `.env`
2. Fill all environment variables
3. Install dependencies:

```bash
npm install
```

4. Run locally:

```bash
npm run dev
```

## API Summary

- `GET /health`
- `GET /auth/me`
- `POST /stores`
- `GET /stores`
- `GET /stores/:id`
- `POST /products`
- `GET /products`
- `GET /products/:id`
- `POST /orders`
- `GET /orders`
- `POST /orders/create-razorpay-order`
- `POST /orders/verify-payment`
- `POST /upload`

## Deployment

### Render

1. Create a new Web Service from the `/backend` folder
2. Build command:

```bash
npm install
```

3. Start command:

```bash
npm start
```

4. Add all environment variables from `.env.example`
5. On Render, Firebase Admin should use env vars instead of a local JSON file:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
6. Set `ENFORCE_HTTPS=true` in production and terminate TLS at the load balancer or platform edge
7. Set `REQUIRE_EMAIL_VERIFICATION=true` for password-based Firebase sign-ins
8. Set `AUTH_MAX_SESSION_AGE_MINUTES` so users must re-authenticate periodically
9. Keep `ENABLE_TEST_AUTH_ROUTES=false` in every non-local environment

### MongoDB Atlas

1. Create a cluster
2. Create a database user
3. Whitelist Render outbound IPs or allow trusted access
4. Set `MONGO_URI`
5. Never expose MongoDB to the public internet without strict IP allowlisting and strong credentials

## Firebase Auth Integration

Frontend sends Firebase ID token as:

```http
Authorization: Bearer <firebase-id-token>
```

Backend verifies the token and creates the user in MongoDB on first authenticated request.

## Security Notes

- Do not deploy `serviceAccountKey.json`; production only loads Firebase credentials from environment variables.
- Do not expose OpenAI, Razorpay secret keys, database credentials, or admin service credentials to Flutter/web builds.
- Authentication, authorization failures, API errors, rate-limit events, and suspicious traffic are logged as structured security events.
