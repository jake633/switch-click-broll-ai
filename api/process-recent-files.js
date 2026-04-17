import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  try {
    console.log('=== PROCESSING RECENT FILES WITH VIDEO ANALYSIS ===');

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // Helper function to download file
    async function downloadFile(fileId, fileName) {
      const tempPath = `/tmp/${fileName}`;
      const dest = fs.createWriteStream(tempPath);
      
      const driveStream = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'stream' });

      return new Promise((resolve, reject) => {
        driveStream.data.pipe(dest)
          .on('finish', () => resolve(tempPath))
          .on('error', reject);
      });
    }

    // Helper function to extract frames using ffmpeg
    async function extractFrames(videoPath, outputDir) {
      await execAsync(`mkdir -p ${outputDir}`);
      
      // Extract 3 frames: beginning (2s), middle, and 2/3 through
      const commands = [
        `ffmpeg -i "${videoPath}" -ss 2 -vframes 1 "${outputDir}/frame1.jpg" -y`,
        `ffmpeg -i "${videoPath}" -ss 50% -vframes 1 "${outputDir}/frame2.jpg" -y`,
        `ffmpeg -i "${videoPath}" -ss 66% -vframes 1 "${outputDir}/frame3.jpg" -y`
      ];

      for (const cmd of commands) {
        await execAsync(cmd);
      }

      return [
        `${outputDir}/frame1.jpg`,
        `${outputDir}/frame2.jpg`, 
        `${outputDir}/frame3.jpg`
      ];
    }

    // Helper function to convert image to base64
    function imageToBase64(imagePath) {
      const imageBuffer = fs.readFileSync(imagePath);
      return imageBuffer.toString('base64');
    }

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

      console.log(`🎬 Processing with AI video analysis: ${file.name}`);

      // Download video file
      console.log('Downloading video...');
      const videoPath = await downloadFile(file.id, file.name);
      
      // Extract frames
      console.log('Extracting frames...');
      const frameDir = `/tmp/frames_${file.id}`;
      const framePaths = await extractFrames(videoPath, frameDir);
      
      // Convert frames to base64
      const frames = framePaths.map(path => {
        if (fs.existsSync(path)) {
          return imageToBase64(path);
        }
        return null;
      }).filter(Boolean);

      console.log(`Extracted ${frames.length} frames`);

      // Build folder path
      let folderPath = 'Root';
      if (file.parents && file.parents.length > 0) {
        folderPath = await buildFolderPath(file.parents[0]);
      }

      const projectType = getProjectTypeFromPath(folderPath);

      // AI video analysis with Claude Vision - NO FALLBACK
      console.log('Analyzing frames with Claude Vision...');
      
      const prompt = `Analyze these frames from a Switch and Click YouTube tech channel B-roll video.

This is the Switch and Click team:
- Jake: CEO, male, main host
- Betty: Head of Content, female, Jake's wife  
- Tyson: Senior Writer, male
- Zack: Videographer, male

Return JSON only:
{
  "people": ["Jake", "Betty", "Tyson", "Zack", "Hands-only", "Unknown"],
  "objects": ["specific tech products you see - be creative and specific"],
  "shot_type": "Close-up|Medium|Wide|Hands|Screen|Product",
  "action": ["specific actions you observe"],
  "location": "Desk|Studio|Home-office|Other",
  "description": "Detailed description of what you see in the video",
  "best_for": ["specific use cases based on what you see"]
}

Instructions:
- For PEOPLE: Choose from Jake, Betty, Tyson, Zack, Hands-only (if only hands visible), or Unknown
- For OBJECTS: Be specific about tech products (keyboard, wireless mouse, webcam, headphones, monitor, cables, etc.)
- Create new object categories as needed for specific tech gear you see
- For ACTIONS: Describe exactly what's happening (typing, gaming, unboxing, adjusting, connecting, etc.)
- Be accurate and descriptive based on what you actually observe in the frames`;

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...frames.slice(0, 2).map(frame => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: frame
              }
            }))
          ]
        }
      ];

      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages
      });

      let analysis;
      try {
        const responseText = aiResponse.content[0].text;
        console.log('AI response:', responseText);
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
          console.log('Parsed AI analysis:', analysis);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (e) {
        console.error('Failed to parse AI response:', e.message);
        // Skip this file if AI analysis fails completely
        continue;
      }

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

      // Create Notion entry with AI analysis
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

      console.log(`✅ Created with AI analysis: ${displayTitle}`);
      processed++;

      // Cleanup temp files
      try {
        await execAsync(`rm -rf ${videoPath} ${frameDir}`);
      } catch (e) {
        console.log('Cleanup warning:', e.message);
      }
    }

    res.status(200).json({
      success: true,
      found: response.data.files.length,
      processed,
      message: `Successfully processed ${processed} new files with AI video analysis`
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
