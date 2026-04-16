import { google } from 'googleapis';
import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  try {
    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    // Get files from last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${tenMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 10,
      fields: 'files(id,name,size,mimeType,webViewLink,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent files`);
    let processed = 0;

    for (const file of response.data.files) {
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      if (fileSizeGB > 3) continue;

      // Check if already processed
      const existing = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Title',
          title: { equals: file.name }
        }
      });

      if (existing.results.length > 0) {
        console.log(`Skip: ${file.name}`);
        continue;
      }

      // Simple analysis based on filename
      const fileName = file.name.toLowerCase();
      let analysis = {
        people: ['Nobody'],
        objects: ['Product'],
        shotType: 'Medium',
        action: ['Demo'],
        location: 'Desk',
        description: `B-roll: ${file.name}`,
        bestFor: ['B-roll']
      };

      if (fileName.includes('keyboard') || fileName.includes('typing')) {
        analysis.objects = ['Keyboard'];
        analysis.action = ['Typing'];
        analysis.bestFor = ['Typing-montage'];
        analysis.description = 'Keyboard typing footage';
      }

      // Create entry
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: file.name } }] },
          'Drive Link': { url: file.webViewLink },
          'Project Type': { select: { name: 'Broll' } },
          'People': { multi_select: analysis.people.map(p => ({ name: p })) },
          'Objects': { multi_select: analysis.objects.map(o => ({ name: o })) },
          'Shot Type': { select: { name: analysis.shotType } },
          'Action': { multi_select: analysis.action.map(a => ({ name: a })) },
          'Location': { select: { name: analysis.location } },
          'Description': { rich_text: [{ text: { content: analysis.description } }] },
          'Best For': { multi_select: analysis.bestFor.map(b => ({ name: b })) },
          'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
          'Processing Date': { date: { start: new Date().toISOString().split('T')[0] } }
        }
      });

      console.log(`✅ Processed: ${file.name}`);
      processed++;
    }
    
    res.status(200).json({ 
      success: true, 
      found: response.data.files.length,
      processed 
    });
    
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: error.message });
  }
}
