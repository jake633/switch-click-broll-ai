import { google } from 'googleapis';
import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  console.log('=== WEBHOOK START ===');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const resourceState = req.headers['x-goog-resource-state'];
    console.log('Resource state:', resourceState);
    
    if (resourceState === 'sync') {
      console.log('Sync notification, ignoring');
      return res.status(200).json({ message: 'Sync ignored' });
    }

    console.log('Processing Drive notification...');

    // Add delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Delay completed');

    // Set up Google Drive API
    console.log('Setting up Drive API...');
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    console.log('Drive API ready');

    // Get recent files
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    console.log('Searching for files newer than:', fiveMinutesAgo);
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${fiveMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 3,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent video files`);
    
    if (response.data.files.length === 0) {
      console.log('No recent files found');
      return res.status(200).json({ message: 'No recent files' });
    }

    // Process each file
    for (const file of response.data.files) {
      console.log(`Checking file: ${file.name}`);
      
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      console.log(`File size: ${fileSizeGB.toFixed(2)}GB`);
      
      if (fileSizeGB > 3) {
        console.log(`Skipping large file: ${file.name}`);
        continue;
      }

      // Set up Notion
      console.log('Setting up Notion API...');
      const notion = new Client({ auth: process.env.NOTION_TOKEN });

      // Check for duplicates
      console.log('Checking for existing entry...');
      const existing = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Title',
          title: { equals: file.name }
        }
      });

      if (existing.results.length > 0) {
        console.log(`Already processed: ${file.name}`);
        continue;
      }

      console.log(`Creating Notion entry for: ${file.name}`);

      // Simple analysis
      let analysis = {
        people: ['Nobody'],
        objects: ['Product'],
        shot_type: 'Medium',
        action: ['Demo'],
        location: 'Desk',
        description: `B-roll clip: ${file.name}`,
        best_for: ['B-roll']
      };

      // Create basic entry
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: file.name } }] },
          'Drive Link': { url: file.webViewLink },
          'Project Type': { select: { name: 'Broll' } },
          'People': { multi_select: analysis.people.map(p => ({ name: p })) },
          'Objects': { multi_select: analysis.objects.map(o => ({ name: o })) },
          'Shot Type': { select: { name: analysis.shot_type } },
          'Action': { multi_select: analysis.action.map(a => ({ name: a })) },
          'Location': { select: { name: analysis.location } },
          'Description': { rich_text: [{ text: { content: analysis.description } }] },
          'Best For': { multi_select: analysis.best_for.map(b => ({ name: b })) },
          'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
          'Processing Date': { date: { start: new Date().toISOString().split('T')[0] } }
        }
      });

      console.log(`✅ Successfully created entry for: ${file.name}`);
    }

    console.log('=== WEBHOOK SUCCESS ===');
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('=== WEBHOOK ERROR ===', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
}
