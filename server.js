/**
 * ============================================================
 * UTU STUDIO · BACKEND SERVER
 * ============================================================
 * Endpoints:
 *   POST   /api/contact         — submit a contact / project inquiry
 *   GET    /api/whatsapp        — generate a pre-filled wa.me link
 *   GET    /api/health          — health probe
 *   GET    /api/admin/leads     — list saved leads (token-protected)
 *
 * Stack: Express + Zod + Nodemailer + better-sqlite3
 * Auth:  Public for contact + whatsapp; admin route uses ADMIN_TOKEN.
 * ============================================================
 */

import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// -------------------------------------------------------------------
// Config (with sane defaults so the server boots even before .env)
// -------------------------------------------------------------------
const cfg = {
  port:           Number(process.env.PORT || 4000),
  ownerName:      process.env.OWNER_NAME      || 'Ayoa Naser',
  ownerEmail:     process.env.OWNER_EMAIL     || 'ayoa.naser96@gmail.com',
  ownerWhatsapp:  process.env.OWNER_WHATSAPP  || '07838896681',
  ownerWaIntl:    process.env.OWNER_WHATSAPP_INTL || '9647838896681',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',').map(s => s.trim()).filter(Boolean),
  smtp: {
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user:   process.env.SMTP_USER   || '',
    pass:   process.env.SMTP_PASS   || '',
    from:   process.env.SMTP_FROM   || 'Utu Studio <ayoa.naser96@gmail.com>',
  },
  adminToken: process.env.ADMIN_TOKEN || 'change-me-please',
  rateWindow: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateMax:    Number(process.env.RATE_LIMIT_MAX || 10),
};

// -------------------------------------------------------------------
// Storage — simple JSON-file persistence (zero native deps, portable)
// For a studio site with a few inquiries a week this is plenty.
// To upgrade later: swap the four functions below for a real DB.
// -------------------------------------------------------------------
const DB_PATH = join(__dirname, 'leads.json');

function loadLeads() {
  if (!existsSync(DB_PATH)) return { next_id: 1, leads: [] };
  try {
    return JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error('[db] corrupt leads.json — starting fresh:', err.message);
    return { next_id: 1, leads: [] };
  }
}

let store = loadLeads();
let writeQueue = Promise.resolve();

async function persist() {
  // Serialize writes so concurrent submissions can't clobber each other
  writeQueue = writeQueue.then(() =>
    fs.writeFile(DB_PATH, JSON.stringify(store, null, 2)).catch(err =>
      console.error('[db] persist failed:', err)
    )
  );
  return writeQueue;
}

async function insertLead(lead) {
  const record = {
    id: store.next_id++,
    ...lead,
    created_at: new Date().toISOString(),
  };
  store.leads.unshift(record);
  // Cap in-memory log (full history still in file via append-mode upgrade later)
  if (store.leads.length > 5000) store.leads.length = 5000;
  await persist();
  return record;
}

function listAllLeads() {
  return store.leads.slice(0, 200);
}

// -------------------------------------------------------------------
// Mailer
// -------------------------------------------------------------------
let transporter = null;
async function getMailer() {
  if (transporter) return transporter;
  if (!cfg.smtp.user || !cfg.smtp.pass) {
    console.warn('[mailer] SMTP not configured — emails will be skipped');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
  });
  try {
    await transporter.verify();
    console.log('[mailer] SMTP ready');
  } catch (err) {
    console.error('[mailer] SMTP verify failed:', err.message);
    transporter = null;
  }
  return transporter;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ownerEmailTemplate(lead) {
  const e = escapeHtml;
  return `
  <!DOCTYPE html><html><body style="font-family:'Inter Tight',sans-serif;background:#f5f0e8;padding:32px;color:#1a1715;">
    <div style="max-width:560px;margin:0 auto;background:#faf6ee;border-radius:20px;padding:40px;border:0.5px solid rgba(26,23,21,0.12);">
      <div style="font-family:Georgia,serif;font-size:32px;font-weight:300;letter-spacing:-0.03em;margin-bottom:8px;">
        New <em style="color:#b85c2f;font-style:italic;">inquiry</em>
      </div>
      <div style="font-family:monospace;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#5a524b;margin-bottom:32px;">
        Utu studio · lead capture
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a524b;width:120px;">Name</td><td style="padding:8px 0;font-weight:500;">${e(lead.name)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a524b;">Email</td><td style="padding:8px 0;"><a href="mailto:${e(lead.email)}" style="color:#b85c2f;text-decoration:none;">${e(lead.email)}</a></td></tr>
        ${lead.phone ? `<tr><td style="padding:8px 0;color:#5a524b;">Phone</td><td style="padding:8px 0;"><a href="https://wa.me/${e(lead.phone.replace(/[^0-9]/g, ''))}" style="color:#b85c2f;text-decoration:none;">${e(lead.phone)}</a></td></tr>` : ''}
        ${lead.company ? `<tr><td style="padding:8px 0;color:#5a524b;">Company</td><td style="padding:8px 0;">${e(lead.company)}</td></tr>` : ''}
        ${lead.project_type ? `<tr><td style="padding:8px 0;color:#5a524b;">Type</td><td style="padding:8px 0;">${e(lead.project_type)}</td></tr>` : ''}
        ${lead.budget ? `<tr><td style="padding:8px 0;color:#5a524b;">Budget</td><td style="padding:8px 0;">${e(lead.budget)}</td></tr>` : ''}
      </table>

      <div style="margin-top:24px;padding:20px;background:#f5f0e8;border-radius:12px;border-left:3px solid #b85c2f;">
        <div style="font-family:monospace;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#5a524b;margin-bottom:8px;">Message</div>
        <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">${e(lead.message)}</div>
      </div>

      <div style="margin-top:32px;padding-top:20px;border-top:0.5px solid rgba(26,23,21,0.12);font-size:11px;color:#5a524b;font-family:monospace;letter-spacing:0.05em;">
        ${e(new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))} · ${e(lead.source || 'website')}
      </div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:11px;color:#5a524b;font-family:monospace;letter-spacing:0.1em;">
      utu studio · designed by dev.aya · baghdad
    </div>
  </body></html>`;
}

function senderConfirmTemplate(lead) {
  const e = escapeHtml;
  return `
  <!DOCTYPE html><html><body style="font-family:'Inter Tight',sans-serif;background:#f5f0e8;padding:32px;color:#1a1715;">
    <div style="max-width:520px;margin:0 auto;background:#faf6ee;border-radius:20px;padding:40px;border:0.5px solid rgba(26,23,21,0.12);">
      <div style="font-family:Georgia,serif;font-size:36px;font-weight:300;letter-spacing:-0.03em;line-height:1;margin-bottom:8px;">
        Thank you, <em style="color:#b85c2f;font-style:italic;">${e(lead.name.split(' ')[0])}.</em>
      </div>
      <div style="font-family:monospace;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#5a524b;margin-bottom:28px;">
        Utu studio · received
      </div>
      <p style="font-size:15px;line-height:1.7;color:#2a2521;">
        Your message reached us. I'll review it personally and respond within
        <strong>24 hours</strong> — usually sooner.
      </p>
      <p style="font-size:15px;line-height:1.7;color:#2a2521;margin-top:16px;">
        If it's urgent, reach me directly on WhatsApp:
      </p>
      <a href="https://wa.me/${cfg.ownerWaIntl}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#b85c2f;color:#faf6ee;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500;">
        WhatsApp · ${e(cfg.ownerWhatsapp)}
      </a>
      <div style="margin-top:40px;padding-top:24px;border-top:0.5px solid rgba(26,23,21,0.12);">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:18px;color:#5a524b;line-height:1.5;">
          "Software worth keeping."
        </div>
        <div style="font-family:monospace;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#5a524b;margin-top:12px;">
          — ${e(cfg.ownerName)} · dev.aya · Baghdad
        </div>
      </div>
    </div>
  </body></html>`;
}

async function sendLeadEmails(lead) {
  const mailer = await getMailer();
  if (!mailer) return { sent: false, reason: 'smtp-not-configured' };

  const ownerMail = mailer.sendMail({
    from: cfg.smtp.from,
    to: cfg.ownerEmail,
    replyTo: lead.email,
    subject: `New inquiry · ${lead.name}${lead.company ? ' · ' + lead.company : ''}`,
    html: ownerEmailTemplate(lead),
  });
  const senderMail = mailer.sendMail({
    from: cfg.smtp.from,
    to: lead.email,
    subject: 'Utu studio — we received your message',
    html: senderConfirmTemplate(lead),
  });

  const [a, b] = await Promise.allSettled([ownerMail, senderMail]);
  return {
    sent: true,
    owner: a.status === 'fulfilled',
    sender: b.status === 'fulfilled',
    errors: [a, b].filter(r => r.status === 'rejected').map(r => r.reason?.message),
  };
}

// -------------------------------------------------------------------
// Validation schema
// -------------------------------------------------------------------
const ContactSchema = z.object({
  name:         z.string().trim().min(2).max(100),
  email:        z.string().trim().email().max(200),
  phone:        z.string().trim().max(40).optional().or(z.literal('')),
  company:      z.string().trim().max(120).optional().or(z.literal('')),
  project_type: z.string().trim().max(80).optional().or(z.literal('')),
  budget:       z.string().trim().max(80).optional().or(z.literal('')),
  message:      z.string().trim().min(10).max(4000),
  source:       z.string().trim().max(40).optional(),
});

// -------------------------------------------------------------------
// App
// -------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (cfg.allowedOrigins.includes('*')) return cb(null, true);
    if (cfg.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  methods: ['GET', 'POST'],
}));

const contactLimiter = rateLimit({
  windowMs: cfg.rateWindow,
  max: cfg.rateMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please try again later.' },
});

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'utu-backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    studio: { name: cfg.ownerName, email: cfg.ownerEmail, location: 'Baghdad / Hay Aljameaa' },
  });
});

// Build a wa.me deep link with a pre-filled message
app.get('/api/whatsapp', (req, res) => {
  const text = (req.query.text || `Hi ${cfg.ownerName} — I saw the Utu studio site and would like to discuss a project.`).toString();
  const url = `https://wa.me/${cfg.ownerWaIntl}?text=${encodeURIComponent(text)}`;
  res.json({
    ok: true,
    whatsapp: cfg.ownerWhatsapp,
    international: cfg.ownerWaIntl,
    email: cfg.ownerEmail,
    url,
  });
});

// Main contact endpoint
app.post('/api/contact', contactLimiter, async (req, res) => {
  // Honeypot first — bots tend to fill every field, so trip them silently
  // before validation, returning a fake success to keep them quiet.
  if (req.body && req.body.hp && String(req.body.hp).length > 0) {
    return res.json({ ok: true, queued: true });
  }

  // Strip the honeypot before validation so legitimate empty values pass
  const body = { ...(req.body || {}) };
  delete body.hp;

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const data = parsed.data;
  const lead = {
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    company: data.company || null,
    project_type: data.project_type || null,
    budget: data.budget || null,
    message: data.message,
    source: data.source || 'website',
    ip: (req.ip || '').slice(0, 45),
    user_agent: (req.get('user-agent') || '').slice(0, 200),
  };

  let saved;
  try {
    saved = await insertLead(lead);
  } catch (err) {
    console.error('[db] insert failed:', err);
    return res.status(500).json({ ok: false, error: 'Could not save inquiry' });
  }

  // Build a one-tap WhatsApp link the frontend can also use
  const waMessage =
    `Hi ${cfg.ownerName}, I just submitted a project inquiry through utu.studio.\n\n` +
    `Name: ${lead.name}\n` +
    `Email: ${lead.email}\n` +
    (lead.company ? `Company: ${lead.company}\n` : '') +
    (lead.project_type ? `Project: ${lead.project_type}\n` : '') +
    `\n${lead.message}`;
  const waUrl = `https://wa.me/${cfg.ownerWaIntl}?text=${encodeURIComponent(waMessage)}`;

  // Fire-and-forget email (we don't make the user wait)
  sendLeadEmails(saved).catch(err => console.error('[mail] async failure:', err));

  res.json({
    ok: true,
    id: saved.id,
    message: 'Thank you — your message reached the studio.',
    next: {
      whatsapp_url: waUrl,
      whatsapp:     cfg.ownerWhatsapp,
      email:        cfg.ownerEmail,
    },
  });
});

// Admin — protected by token header
app.get('/api/admin/leads', (req, res) => {
  const token = req.get('x-admin-token');
  if (!token || token !== cfg.adminToken) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const rows = listAllLeads();
  res.json({ ok: true, count: rows.length, leads: rows });
});

// Static frontend (so you can serve the whole site from one process)
app.use(express.static(join(__dirname, '..', 'frontend')));

// Fallthrough 404 for /api/*
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// -------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------
app.listen(cfg.port, () => {
  console.log('=========================================');
  console.log(' UTU studio · backend ready');
  console.log(' Listening on http://localhost:' + cfg.port);
  console.log(' Owner:   ' + cfg.ownerName + ' <' + cfg.ownerEmail + '>');
  console.log(' WhatsApp: ' + cfg.ownerWhatsapp + ' (intl: ' + cfg.ownerWaIntl + ')');
  console.log(' Origins: ' + (cfg.allowedOrigins.join(', ') || '*'));
  console.log('=========================================');
  // Warm the mailer so we know early if SMTP is broken
  getMailer();
});
