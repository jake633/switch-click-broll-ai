// api/drive-webhook.js - Just acknowledge webhooks
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resourceState = req.headers['x-goog-resource-state'];
  if (resourceState === 'sync') {
    return res.status(200).json({ message: 'Sync ignored' });
  }

  console.log('📁 Drive change notification received');
  res.status(200).json({ message: 'Webhook received' });
}
