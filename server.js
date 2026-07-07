require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();

// Behind CloudFront/API Gateway we want the real client IP for rate limiting.
app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));

// ── Config ────────────────────────────────────────────────
const ALLOWED_MODELS = new Set(['claude-sonnet-4-5-20250929']);
const MAX_TOKENS_CAP = 1500;
const IS_LAMBDA = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
// In Lambda the only writable path is /tmp; locally drop next to server.js
const CLICKS_LOG = IS_LAMBDA
  ? '/tmp/clicks.log'
  : path.join(__dirname, 'clicks.log');

// ── Anthropic key loader ──────────────────────────────────
// Read from env var everywhere (.env locally, Lambda environment config in
// prod). Lambda env vars are encrypted at rest by default, so this avoids the
// $0.40/mo flat Secrets Manager fee — worth it only at genuinely low volume,
// where rotation/audit-trail features aren't needed. Falls back to Secrets
// Manager only if ANTHROPIC_SECRET_NAME is explicitly set (opt-in).
let cachedKey = null;
async function getAnthropicKey() {
  if (cachedKey) return cachedKey;

  if (IS_LAMBDA && process.env.ANTHROPIC_SECRET_NAME) {
    // Lazy-require the AWS SDK so local dev doesn't need it.
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({});
    const out = await client.send(new GetSecretValueCommand({ SecretId: process.env.ANTHROPIC_SECRET_NAME }));
    const parsed = JSON.parse(out.SecretString || '{}');
    cachedKey = parsed.ANTHROPIC_API_KEY || null;
  } else {
    cachedKey = process.env.ANTHROPIC_API_KEY || null;
  }
  return cachedKey;
}

// ── Rate limiting (10 req/min per IP) ─────────────────────
const claudeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests. Try again in a minute.' } },
});

// ── Shared site-key check ─────────────────────────────────
// Not real cryptographic auth — REACT_APP_JEANIE_SITE_KEY ships inside the
// client bundle, so anyone reading the page source can find it. It exists to
// stop naive/scripted bots from hitting the endpoint directly without ever
// loading the site, not to stop a determined attacker who inspects the bundle.
function requireSiteKey(req, res, next) {
  const expected = process.env.JEANIE_SITE_KEY;
  if (!expected) return next(); // not configured — skip (e.g. quick local testing)
  if (req.get('x-jeanie-key') !== expected) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
  next();
}

// ── Input validation middleware ───────────────────────────
function validateClaudeRequest(req, res, next) {
  const { model, max_tokens, messages } = req.body || {};

  if (!model || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: { message: `model must be one of: ${[...ALLOWED_MODELS].join(', ')}` } });
  }
  if (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > MAX_TOKENS_CAP) {
    return res.status(400).json({ error: { message: `max_tokens must be a number between 1 and ${MAX_TOKENS_CAP}` } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages must be a non-empty array' } });
  }
  next();
}

// ── Anthropic proxy ───────────────────────────────────────
app.post('/api/claude', claudeLimiter, requireSiteKey, validateClaudeRequest, async (req, res) => {
  const apiKey = await getAnthropicKey();

  if (!apiKey || apiKey.startsWith('sk-ant-YOUR_')) {
    return res.status(500).json({ error: { message: 'API key not configured' } });
  }

  // Retry on 429/529 with exponential backoff (max 2 retries)
  const callAnthropic = async (attempt = 0) => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    if ((response.status === 429 || response.status === 529) && attempt < 2) {
      const backoff = 500 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, backoff));
      return callAnthropic(attempt + 1);
    }
    return response;
  };

  try {
    const response = await callAnthropic();
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    console.error('Proxy error:', e.message);
    res.status(500).json({ error: { message: 'Upstream request failed' } });
  }
});

// ── Tracked brand redirect ────────────────────────────────
// Usage: <a href={`/api/r?brand=${encodeURIComponent(b.brand)}&url=${encodeURIComponent(b.url)}`}>
app.get('/api/r', (req, res) => {
  const { brand, url } = req.query;

  if (!url || typeof url !== 'string') return res.status(400).send('missing url');
  let dest;
  try {
    dest = new URL(url);
    if (!['http:', 'https:'].includes(dest.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).send('invalid url');
  }

  const entry = {
    ts: new Date().toISOString(),
    brand: typeof brand === 'string' ? brand.slice(0, 80) : null,
    url: dest.toString(),
    ip: req.ip,
    ua: (req.get('user-agent') || '').slice(0, 200),
  };

  if (IS_LAMBDA) {
    // CloudWatch is the system of record in prod; ephemeral /tmp is just a buffer.
    console.log('CLICK', JSON.stringify(entry));
  }
  fs.appendFile(CLICKS_LOG, JSON.stringify(entry) + '\n', err => {
    if (err) console.error('clicks.log write failed:', err.message);
  });

  res.redirect(302, dest.toString());
});

// ── Start (only when run directly, not when require()d by Lambda) ──
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log('');
    console.log('✅ Jeanie proxy server running on port ' + PORT);
    console.log('   API key loaded: ' + (process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO'));
    console.log('   Click log: ' + CLICKS_LOG);
    console.log('');
  });
}

module.exports = app;
