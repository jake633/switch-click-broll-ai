import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    console.log('Testing Drive API directly...');

    // Set up Google Drive API
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });

    // Get recent files (last 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    console.log('Searching for files newer than:', thirtyMinutesAgo);
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${thirtyMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 10,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent files`);
    
    const results = response.data.files.map(file => ({
      name: file.name,
      size: Math.round(parseInt(file.size) / (1024 * 1024)) + 'MB',
      created: file.createdTime,
      parents: file.parents
    }));

    res.status(200).json({
      success: true,
      query: `Files in folder created after ${thirtyMinutesAgo}`,
      count: response.data.files.length,
      files: results
    });

  } catch (error) {
    console.error('Drive API test error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
