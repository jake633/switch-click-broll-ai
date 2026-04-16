export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Make a POST request to our setup endpoint
    const baseUrl = req.headers.host?.includes('localhost') 
      ? 'http://localhost:3000' 
      : 'https://switch-click-broll-ai.vercel.app';
      
    const response = await fetch(`${baseUrl}/api/setup-drive-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    res.status(200).json({ 
      success: response.ok, 
      status: response.status,
      setupResponse: data 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
