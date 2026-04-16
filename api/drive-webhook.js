import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const resourceState = req.headers['x-goog-resource-state'];
    if (resourceState === 'sync') {
      return res.status(200).json({ message: 'Sync ignored' });
    }

    // Add delay to batch notifications
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // Get files from last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${fiveMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 3,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)' // ← Update this line
    });

    for (const file of response.data.files) {
  const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
  if (fileSizeGB > 3) continue;

  // ADD THE NEW FOLDER DETECTION CODE HERE
  console.log('File details:', {
    name: file.name,
    parents: file.parents,
    createdTime: file.createdTime
  });

  // Get parent folder info to determine project type
  let projectType = 'Other';
  // ... rest of folder detection code

  // Then continue with existing duplicate check
  const existing = await notion.databases.query({
    // ... existing code
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
        console.log(`Already processed: ${file.name}`);
        continue;
      }

      console.log(`Processing: ${file.name}`);

      // Simple filename-based analysis for now
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

      console.log(`✅ Created entry: ${file.name}`);
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
