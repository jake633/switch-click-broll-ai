import { google } from 'googleapis';
import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  try {
    console.log('=== PROCESSING RECENT FILES ===');

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    // Get files from last 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    console.log('Searching for files newer than:', thirtyMinutesAgo);
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${thirtyMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 10,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent files`);

    if (response.data.files.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No recent video files found',
        searchedSince: thirtyMinutesAgo
      });
    }

    let processed = 0;

    for (const file of response.data.files) {
      console.log(`Checking: ${file.name}`);
      
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      if (fileSizeGB > 3) {
        console.log(`Skipping large file: ${file.name} (${fileSizeGB.toFixed(2)}GB)`);
        continue;
      }

      // Check if already processed
      const existing = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Title',
          title: { equals: file.name }
        }
      });

      if (existing.results.length > 0) {
        console.log(`Already exists: ${file.name}`);
        continue;
      }

      console.log(`Processing: ${file.name}`);

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

      const fileName = file.name.toLowerCase();
      if (fileName.includes('keyboard') || fileName.includes('typing')) {
        analysis.objects = ['Keyboard'];
        analysis.action = ['Typing'];
        analysis.best_for = ['Typing-montage'];
        analysis.description = 'Keyboard typing footage';
      }

      // Create Notion entry
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

      console.log(`✅ Created: ${file.name}`);
      processed++;
    }

    res.status(200).json({
      success: true,
      found: response.data.files.length,
      processed,
      message: `Successfully processed ${processed} new files`
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
