import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const geminiKey = process.env.GEMINI_API_KEY;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5176';
const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
const allowedOrigins = clientOrigin.split(',').map((origin) => origin.trim());

app.use(cors({ origin: allowedOrigins, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const requireAdmin = (req, res, next) => {
  if (!supabaseJwtSecret) {
    console.error('Missing SUPABASE_JWT_SECRET');
    return res.status(500).json({ error: 'Missing SUPABASE_JWT_SECRET' });
  }
  if (!adminEmail) {
    console.error('Missing ADMIN_EMAIL');
    return res.status(500).json({ error: 'Missing ADMIN_EMAIL' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    const payload = jwt.verify(token, supabaseJwtSecret, { algorithms: ['HS256'] });
    const email = (payload?.email || '').toLowerCase();
    if (email !== adminEmail) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/rewrite', requireAdmin, async (req, res) => {
  try {
    if (!geminiKey) {
      console.error('Missing GEMINI_API_KEY');
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
    }
    const { text, context } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    const prompt = `Réécris une description immobilière claire, concise et professionnelle.
Conserve les faits et ne les invente pas. Garde la langue française.
Contexte: ${context || 'Non fourni'}
Description d'origine: ${text}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `Tu es un assistant immobilier.\n\n${prompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
        },
      }),
    }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini error:', errorText);
      return res.status(500).json({ error: 'Gemini error', details: errorText });
    }
    const data = await response.json();
    const rewritten = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rewritten) {
      console.error('No completion returned');
      return res.status(500).json({ error: 'No completion returned' });
    }
    console.log('Rewrite ok');
    return res.json({ text: rewritten });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`AI server listening on http://localhost:${port}`);
});
