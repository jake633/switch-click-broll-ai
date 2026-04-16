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

    // Add a small delay to let multiple notifications settle
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

    // Get files from last 5 minutes only
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${fiveMinutesAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 3,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent video files`);

    for (const file of response.data.files) {
      const fileSizeGB = parseInt(file.size) / (1024 * 1024 * 1024);
      if (fileSizeGB > 3) {
        console.log(`Skipping large file: ${file.name}`);
        continue;
      }

      // Check if already processed by filename
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

      console.log(`Processing new file: ${file.name}`);

      // Determine project type from path
      let projectType = 'Other';
      // We'd need to get the full path to determine this properly
      // For now, default to 'Broll'
      projectType = 'Broll';

      // AI Analysis
      const prompt = `Analyze this Switch and Click B-roll video file:

Filename: ${file.name}
Context: YouTube tech channel B-roll footage

Categorize this clip and return only valid JSON:
{
  "people": ["Jake", "Betty", "Hands-only", "Nobody"],
  "objects": ["Keyboard", "Mouse", "Monitor", "Product", "Cables", "Desk", "Setup"],
  "shot_type": "Close-up",
  "action": ["Typing", "Explaining", "Unboxing", "Setup", "Pointing", "Holding", "Demo"],
  "location": "Desk",
  "description": "Brief description",
  "best_for": ["Typing-montage", "Keyboard-review", "Tech-setup", "Unboxing", "B-roll"]
}

Use arrays for multi-select fields, single strings for select fields.`;

      let analysis;
      try {
        const aiResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        });

        const jsonText = aiResponse.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        analysis = JSON.parse(jsonText);
        console.log('AI analysis:', analysis);
      } catch (e) {
        console.error('AI analysis failed:', e);
        analysis = {
          people: ['Nobody'],
          objects: ['Product'],
          shot_type: 'Medium',
          action: ['Demo'],
          location: 'Desk',
          description: `B-roll clip: ${file.name}`,
          best_for: ['B-roll']
        };
      }

      // Create Notion entry
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: file.name } }] },
          'Drive Link': { url: file.webViewLink },
          'Project Type': { select: { name: projectType } },
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
    
    res.status(200).json({ success: true, processed: response.data.files.length });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
}
