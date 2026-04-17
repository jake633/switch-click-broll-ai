import { google } from 'googleapis';
import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  try {
    console.log('=== PROCESSING RECENT FILES WITH AI ANALYSIS ===');

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    // Function to build full folder path
    async function buildFolderPath(folderId, path = []) {
      if (!folderId || folderId === '1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H') {
        return path.reverse().join(' → ');
      }

      try {
        const folderInfo = await drive.files.get({
          fileId: folderId,
          fields: 'name,parents'
        });

        path.push(folderInfo.data.name);

        if (folderInfo.data.parents && folderInfo.data.parents.length > 0) {
          return await buildFolderPath(folderInfo.data.parents[0], path);
        }

        return path.reverse().join(' → ');
      } catch (e) {
        console.log('Error building path:', e.message);
        return path.reverse().join(' → ');
      }
    }

    // Function to determine project type from path
    function getProjectTypeFromPath(folderPath) {
      const pathLower = folderPath.toLowerCase();
      if (pathLower.includes('shorts')) return 'Shorts';
      if (pathLower.includes('midroll')) return 'Midrolls';
      if (pathLower.includes('member')) return 'Members';
      if (pathLower.includes('active')) return 'Active Videos';
      return 'Broll';
    }

    // Search for files from last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    console.log('Searching for files newer than:', twoHoursAgo);
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${twoHoursAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 5,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    console.log(`Found ${response.data.files.length} recent video files`);

    if (response.data.files.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No recent video files found',
        searchedSince: twoHoursAgo
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

      // Check if already processed by Drive Link
      const existing = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Drive Link',
          url: { equals: file.webViewLink }
        }
      });

      if (existing.results.length > 0) {
        console.log(`Already exists: ${file.name}`);
        continue;
      }

      console.log(`📝 Processing with filename analysis: ${file.name}`);

      // Build folder path
      let folderPath = 'Root';
      if (file.parents && file.parents.length > 0) {
        folderPath = await buildFolderPath(file.parents[0]);
        console.log(`Folder path: ${folderPath}`);
      }

      const projectType = getProjectTypeFromPath(folderPath);

      // Enhanced filename-based analysis (no video processing for now)
      let analysis = {
        people: ['Unknown'],
        objects: ['Tech Product'],
        shot_type: 'Medium',
        action: ['Demo'],
        location: 'Desk',
        description: `B-roll clip: ${file.name}`,
        best_for: ['B-roll']
      };

      const fileName = file.name.toLowerCase();
      
      // Enhanced filename analysis
      if (fileName.includes('keyboard') || fileName.includes('typing')) {
        analysis.objects = ['Mechanical Keyboard'];
        analysis.action = ['Typing'];
        analysis.best_for = ['Typing-montage', 'Keyboard-review'];
        analysis.description = 'Keyboard typing footage';
      } else if (fileName.includes('mouse')) {
        analysis.objects = ['Mouse'];
        analysis.shot_type = 'Close-up';
        analysis.best_for = ['Product-demo'];
      } else if (fileName.includes('monitor') || fileName.includes('display')) {
        analysis.objects = ['Monitor'];
        analysis.best_for = ['Setup-tour', 'Tech-review'];
      }

      // Basic person detection from filename
      if (fileName.includes('jake')) analysis.people = ['Jake'];
      else if (fileName.includes('betty')) analysis.people = ['Betty'];
      else if (fileName.includes('tyson')) analysis.people = ['Tyson'];
      else if (fileName.includes('zack')) analysis.people = ['Zack'];
      else if (fileName.includes('hands')) analysis.people = ['Hands-only'];

      // Create unique title for duplicates
      const nameCheck = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'Title',
          title: { equals: file.name }
        }
      });

      const displayTitle = nameCheck.results.length > 0 ? 
        `${file.name} (${new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })})` : 
        file.name;

      // Create Notion entry
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Title': { title: [{ text: { content: displayTitle } }] },
          'Drive Link': { url: file.webViewLink },
          'Project Type': { select: { name: projectType } },
          'People': { multi_select: analysis.people.map(p => ({ name: p })) },
          'Objects': { multi_select: analysis.objects.map(o => ({ name: o })) },
          'Shot Type': { select: { name: analysis.shot_type } },
          'Action': { multi_select: analysis.action.map(a => ({ name: a })) },
          'Location': { select: { name: analysis.location } },
          'Description': { rich_text: [{ text: { content: `${analysis.description} (${folderPath})` } }] },
          'Best For': { multi_select: analysis.best_for.map(b => ({ name: b })) },
          'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
          'Processing Date': { date: { start: new Date().toISOString().split('T')[0] } }
        }
      });

      console.log(`✅ Created: ${displayTitle} in ${projectType} (${folderPath})`);
      processed++;
    }

    res.status(200).json({
      success: true,
      found: response.data.files.length,
      processed,
      message: `Successfully processed ${processed} new files with enhanced analysis`
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
