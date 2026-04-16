export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch('https://switch-click-broll-ai.vercel.app/api/setup-drive-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const responseText = await response.text(); // Get raw text instead of JSON
    
    res.status(200).json({ 
      success: response.ok, 
      status: response.status,
      headers: Object.fromEntries(response.headers),
      rawResponse: responseText.substring(0, 500) // First 500 chars
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
