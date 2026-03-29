# ABZORA Backend

Production backend for ABZORA using:

- Node.js + Express
- MongoDB + Mongoose
- Cloudinary
- Razorpay
- Firebase Auth only

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

### MongoDB Atlas

1. Create a cluster
2. Create a database user
3. Whitelist Render outbound IPs or allow trusted access
4. Set `MONGO_URI`

## Firebase Auth Integration

Frontend sends Firebase ID token as:

```http
Authorization: Bearer <firebase-id-token>
```

Backend verifies the token and creates the user in MongoDB on first authenticated request.
