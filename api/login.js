export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });

  const masterPassword = process.env.MASTER_PASSWORD || 'JMtravel';

  if (password === masterPassword) {
    return res.status(200).json({ role: 'admin' });
  }

  // Check guest credentials
  let guests = [];
  try {
    guests = JSON.parse(process.env.GUEST_CREDENTIALS || '[]');
  } catch (_) {}

  const now = new Date();
  const guest = guests.find(g => g.password === password);

  if (!guest) {
    return res.status(401).json({ error: 'invalid', message: 'Incorrect password' });
  }

  if (guest.expiresAt && new Date(guest.expiresAt) < now) {
    return res.status(401).json({ error: 'expired', message: 'This access link has expired. Please contact JM for a new one.' });
  }

  return res.status(200).json({
    role: 'guest',
    email: guest.email,
    countries: guest.countries || []
  });
}
