export default async function handler(req, res) {
  console.log('=== WEBHOOK RECEIVED ===', {
    method: req.method,
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Google Drive sends direct notifications, not Pub/Sub format
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    const resourceId = req.headers['x-goog-resource-id'];
    
    console.log('Drive notification:', {
      channelId,
      resourceState,
      resourceId
    });

    if (resourceState === 'sync') {
      console.log('Sync notification, ignoring');
      return res.status(200).json({ message: 'Sync ignored' });
    }

    console.log('File change detected, processing...');
    
    // TODO: Add file processing logic here
    
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed successfully',
      resourceState,
      channelId
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
