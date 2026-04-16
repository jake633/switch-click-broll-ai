import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';

// Simple in-memory lock to prevent concurrent processing
const processingLock = new Set();

export default async function handler(req, res) {
  const requestId = req.headers['x-goog-channel-id'] + '-' + Date.now();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const resourceState = req.headers['x-goog-resource-state'];
    if (resourceState === 'sync') {
      return res.status(200).json({ message: 'Sync ignored' });
    }

    // Check if already processing
    if (processingLock.has('processing')) {
      console.log('Already processing, skipping...');
      return res.status(200).json({ message: 'Already processing' });
    }

    // Set lock
    processingLock.add('processing');
    
    try {
      // Add delay to batch multiple notifications
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Set up APIs
      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const drive = google.drive({ version: 'v3', auth });
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

      // Get very recent files (last 2 minutes)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      
      const response = await drive.files.list({
        q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${twoMinutesAgo}'`,
        orderBy: 'createdTime desc',
        pageSize: 5,
        fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
      });

      console.log(`Found ${response.data.files.length} recent files`);

      for (const file of response.data.files) {
        const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
        if (fileSizeGB > 3) continue;

        // Check existing entries
        const existing = await notion.databases.query({
          database_id: process.env.NOTION_DATABASE_ID,
          filter: {
            property: 'Title',
            title: { equals: file.name }
          }
        });

        if (existing.results.length > 0) {
          console.log(`✅ Already exists: ${file.name}`);
          continue;
        }

        console.log(`🎬 Processing: ${file.name}`);

        // AI Analysis
        const prompt = `Analyze this tech video B-roll clip:

Filename: ${file.name}

Return valid JSON only:
{
  "people": ["Jake", "Betty", "Hands-only", "Nobody"],
  "objects": ["Keyboard", "Mouse", "Monitor", "Product", "Cables", "Desk", "Setup"],  
  "shot_type": "Close-up",
  "action": ["Typing", "Explaining", "Unboxing", "Setup", "Pointing", "Holding", "Demo"],
  "location": "Desk",
  "description": "Brief description of the clip",
  "best_for": ["Typing-montage", "Keyboard-review", "Tech-setup", "Unboxing", "B-roll"]
}`;

        let analysis = {
          people: ['Nobody'],
          objects: ['Product'], 
          shot_type: 'Medium',
          action: ['Demo'],
          location: 'Desk',
          description: `B-roll: ${file.name}`,
          best_for: ['B-roll']
        };

        try {
          const aiResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }]
          });

          const text = aiResponse.content[0].text;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysis = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.log('Using fallback analysis');
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
      }

    } finally {
      // Always release lock
      processingLock.delete('processing');
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    processingLock.delete('processing');
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
