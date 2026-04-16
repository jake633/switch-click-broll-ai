import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use Betty's OAuth credentials
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    auth.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // Set up webhook for Switch and Click Videos folder
    const response = await drive.files.watch({
      fileId: '1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      requestBody: {
        id: `switch-click-broll-watch-${Date.now()}`,
        type: 'web_hook',
        address: `https://switch-click-broll-ai.vercel.app/api/drive-webhook`
      }
    });
    
    res.status(200).json({ 
      success: true, 
      webhook: response.data,
      message: 'Drive webhook configured successfully!'
    });
    
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message });
  }
}
