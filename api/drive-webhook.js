import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  console.log('=== WEBHOOK RECEIVED ===', req.headers['x-goog-resource-state']);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const resourceState = req.headers['x-goog-resource-state'];
    if (resourceState === 'sync') {
      return res.status(200).json({ message: 'Sync ignored' });
    }

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // Get recent files
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video'`,
      orderBy: 'createdTime desc',
      pageSize: 3,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    for (const file of response.data.files) {
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      if (fileSizeGB > 3) continue;

      // Better duplicate detection using filename
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

      // AI Analysis based on filename and path
      const prompt = `Analyze this Switch and Click B-roll video file for categorization:

Filename: ${file.name}
Path: Switch and Click Videos (YouTube tech channel)

Return JSON only:
{
  "people": ["Jake", "Betty", "Hands-only", "Nobody"],
  "objects": ["Keyboard", "Mouse", "Monitor", "Product", "Cables", "Desk", "Setup"],
  "shot_type": "Close-up|Medium|Wide|Hands|Screen|Product",
  "action": ["Typing", "Explaining", "Unboxing", "Setup", "Pointing", "Holding", "Demo"],
  "location": "Desk|Studio|Home-office|Other",
  "description": "Brief description of what this clip shows",
  "best_for": ["Typing-montage", "Keyboard-review", "Tech-setup", "Unboxing", "B-roll"]
}`;

      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      });

      let analysis;
      try {
        analysis = JSON.parse(aiResponse.content[0].text);
      } catch (e) {
        analysis = {
          people: ['Nobody'],
          objects: ['Other'],
          shot_type: 'Medium',
          action: ['Demo'],
          location: 'Other',
          description: 'AI analysis failed',
          best_for: ['B-roll']
        };
      }

      // Create Notion entry with AI analysis
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: file.name } }] },
          'Drive Link': { url: file.webViewLink },
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

      console.log(`Created AI-analyzed entry for: ${file.name}`);
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
