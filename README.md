# UTU · studio site (frontend + backend)

A single-page editorial site for **Utu studio** with a working contact pipeline.
Designed and built by **dev.aya** · Baghdad / Hay Aljameaa.

```
utu/
├── frontend/
│   └── index.html         ← the site (open this directly in dev, or serve from backend)
└── backend/
│   ├── server.js          ← Express API + static server
│   ├── package.json
│   ├── .env.example       ← copy to .env, fill in SMTP creds
│   └── leads.json         ← created automatically on first run
└── README.md
```

---

## What the site does

Three sections sharing one design system:

1. **Style** — the design tokens, palette, typography, component library
2. **Product** — a live SwiftDrop dashboard mockup (Iraq operations, IQD)
3. **Studio** — the public marketing surface with portfolio + contact form

A persistent floating WhatsApp button is on every section. The contact form
in section 03 submits to `/api/contact`, which:

- Validates the input (Zod schema)
- Saves it to a local JSON file (`leads.json`)
- Sends you an email at `ayoa.naser96@gmail.com` with the full inquiry
- Sends the prospect a confirmation email
- Returns a one-tap WhatsApp link pre-filled with their message
- Rate-limits to 10 submissions / 15min per IP
- Has a honeypot field to silently drop bots

---

## Running it locally

### 1. Install backend deps
```bash
cd backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Open .env and add your Gmail App Password (see below)
```

### 3. Get a Gmail App Password (one-time, takes 2 minutes)
The site sends emails from `ayoa.naser96@gmail.com`. Gmail blocks plain
password auth, so you need an **App Password**:

1. Go to https://myaccount.google.com/security
2. Turn on **2-Step Verification** (required first)
3. Go to https://myaccount.google.com/apppasswords
4. Create a password named "Utu studio"
5. Paste the 16-character code into `SMTP_PASS` in your `.env`

### 4. Start the server
```bash
npm start
# or for live reload during dev:
npm run dev
```

Visit **http://localhost:4000** — the site is served from the backend, and
the contact form will hit the same origin's API. No CORS setup required.

---

## API reference

### `POST /api/contact`
Submit a contact inquiry.

```json
{
  "name": "Hassan Karim",
  "email": "hassan@example.com",
  "phone": "+9647701234567",
  "company": "Karim Logistics",
  "project_type": "Mobile app",
  "budget": "$10k–$25k",
  "message": "We need a driver app similar to SwiftDrop..."
}
```

Returns:
```json
{
  "ok": true,
  "id": 42,
  "next": {
    "whatsapp_url": "https://wa.me/9647838896681?text=...",
    "whatsapp": "07838896681",
    "email": "ayoa.naser96@gmail.com"
  }
}
```

### `GET /api/whatsapp?text=Hello`
Returns a `wa.me` deep link with a pre-filled message.

### `GET /api/health`
Health check + studio info.

### `GET /api/admin/leads`
List all saved leads. Send header `x-admin-token: <ADMIN_TOKEN from .env>`.

---

## Deployment notes

The backend is a single-process Node app with file-based JSON storage
— it runs anywhere Node 18+ runs:

- **Railway / Render / Fly.io** — drop in the repo, set env vars, done.
- **VPS** — `pm2 start server.js --name utu` and put nginx in front.
- **Vercel / Netlify** — these are static-only, so split: deploy the
  `frontend/` to Netlify and the backend to Railway, then update
  `ALLOWED_ORIGINS` in `.env` and the `API_BASE` constant in `index.html`.

The `leads.json` file persists on disk; back it up with a daily cron if
you want a long-term record. To upgrade to a real database later (Postgres,
SQLite), only the four storage helpers in `server.js` need to change.

---

## Studio contact

- **WhatsApp** — 07838896681 (international: +964 783 889 6681)
- **Email**    — ayoa.naser96@gmail.com
- **Location** — Baghdad · Hay Aljameaa
- **Designed by** — dev.aya
