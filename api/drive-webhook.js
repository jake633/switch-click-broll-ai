export default async function handler(req, res) {
  // Log every single request
  console.log('=== WEBHOOK RECEIVED ===', {
    method: req.method,
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body
  });

  if (req.method !== 'POST') {
    console.log('Non-POST request, rejecting');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Processing webhook...');
    
    // For now, just log and respond OK
    res.status(200).json({ 
      success: true, 
      message: 'Webhook received and logged',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
