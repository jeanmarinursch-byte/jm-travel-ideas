import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });

  let creds;
  try {
    const file = readFileSync(join(process.cwd(), 'credentials.json'), 'utf8');
    creds = JSON.parse(file);
  } catch (_) {
    return res.status(500).json({ error: 'Configuration error' });
  }

  const hash = sha256(password);

  if (hash === creds.masterHash) {
    return res.status(200).json({ role: 'admin' });
  }

  const now = new Date();
  const guest = creds.guests.find(g => g.passwordHash === hash);

  if (!guest) {
    return res.status(401).json({ error: 'invalid', message: 'Incorrect password' });
  }

  if (guest.expiresAt && new Date(guest.expiresAt) < now) {
    return res.status(401).json({ error: 'expired', message: 'This access has expired. Please contact JM for a new one.' });
  }

  return res.status(200).json({
    role: 'guest',
    email: guest.email,
    countries: guest.countries || []
  });
}
