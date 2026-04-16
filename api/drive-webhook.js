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

    // Random delay between 1-4 seconds to spread out concurrent requests
    const delay = Math.floor(Math.random() * 3000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    // Only process files from the last 1 minute
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${oneMinuteAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 2,
      fields: 'files(id,name,size,mimeType,webViewLink,createdTime)'
    });

    console.log(`Processing ${response.data.files.length} recent files`);

    if (response.data.files.length === 0) {
      return res.status(200).json({ message: 'No recent files' });
    }

    // Process only the most recent file to avoid duplicates
    const file = response.data.files[0];
    const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
    
    if (fileSizeGB > 3) {
      console.log(`File too large: ${file.name}`);
      return res.status(200).json({ message: 'File too large' });
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
      return res.status(200).json({ message: 'Already processed' });
    }

    console.log(`🎬 Analyzing: ${file.name}`);

    // Simple AI analysis based on filename
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    
    let description = `B-roll clip: ${file.name}`;
    let people = ['Nobody'];
    let objects = ['Product'];
    let shotType = 'Medium';
    let action = ['Demo'];
    let location = 'Desk';
    let bestFor = ['B-roll'];

    // Quick filename-based analysis
    const fileName = file.name.toLowerCase();
    if (fileName.includes('keyboard') || fileName.includes('typing')) {
      objects = ['Keyboard'];
      action = ['Typing'];
      bestFor = ['Typing-montage', 'Keyboard-review'];
      description = 'Keyboard typing footage';
    } else if (fileName.includes('mouse')) {
      objects = ['Mouse'];
      bestFor = ['Tech-setup'];
    } else if (fileName.includes('unbox')) {
      action = ['Unboxing'];
      bestFor = ['Unboxing'];
      description = 'Product unboxing footage';
    }

    // Create Notion entry
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Title': { title: [{ text: { content: file.name } }] },
        'Drive Link': { url: file.webViewLink },
        'Project Type': { select: { name: 'Broll' } },
        'People': { multi_select: people.map(p => ({ name: p })) },
        'Objects': { multi_select: objects.map(o => ({ name: o })) },
        'Shot Type': { select: { name: shotType } },
        'Action': { multi_select: action.map(a => ({ name: a })) },
        'Location': { select: { name: location } },
        'Description': { rich_text: [{ text: { content: description } }] },
        'Best For': { multi_select: bestFor.map(b => ({ name: b })) },
        'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
        'Processing Date': { date: { start: new Date().toISOString().split('T')[0] } }
      }
    });

    console.log(`✅ Created entry for: ${file.name}`);
    res.status(200).json({ success: true, file: file.name });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
