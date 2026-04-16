import { google } from 'googleapis';
import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  console.log('=== WEBHOOK RECEIVED ===', {
    method: req.method,
    timestamp: new Date().toISOString(),
    headers: req.headers
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    const resourceId = req.headers['x-goog-resource-id'];
    
    console.log('Drive notification:', { channelId, resourceState, resourceId });

    if (resourceState === 'sync') {
      return res.status(200).json({ message: 'Sync ignored' });
    }

    // Set up Google Drive API
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const drive = google.drive({ version: 'v3', auth });

    // Get recent files in the folder
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video'`,
      orderBy: 'createdTime desc',
      pageSize: 5,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log('Recent files:', response.data.files);

    for (const file of response.data.files) {
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      
      if (fileSizeGB > 3) {
        console.log(`Skipping large file: ${file.name} (${fileSizeGB.toFixed(2)}GB)`);
        continue;
      }

      // Check if already processed (basic duplicate prevention)
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      const existing = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Drive Link',
          url: { equals: file.webViewLink }
        }
      });

      if (existing.results.length > 0) {
        console.log(`File already processed: ${file.name}`);
        continue;
      }

      console.log(`Processing new file: ${file.name}`);

      // Create basic Notion entry (we'll add AI analysis later)
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: file.name } }] },
          'Drive Link': { url: file.webViewLink },
          'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
          'Processing Date': { 
            date: { start: new Date().toISOString().split('T')[0] }
          },
          'Description': { 
            rich_text: [{ text: { content: 'Processing...' } }] 
          }
        }
      });

      console.log(`Created Notion entry for: ${file.name}`);
    }
    
    res.status(200).json({ success: true, message: 'Files processed' });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
