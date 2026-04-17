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
    console.log('=== PROCESSING RECENT FILES WITH VISUAL AI ANALYSIS ===');

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
      
      // Extract 3 frames: beginning (3s), middle, and 2/3 through
      const commands = [
        `ffmpeg -i "${videoPath}" -ss 3 -vframes 1 "${outputDir}/frame1.jpg" -y`,
        `ffmpeg -i "${videoPath}" -ss 50% -vframes 1 "${outputDir}/frame2.jpg" -y`,
        `ffmpeg -i "${videoPath}" -ss 75% -vframes 1 "${outputDir}/frame3.jpg" -y`
      ];

      for (const cmd of commands) {
        try {
          await execAsync(cmd);
        } catch (e) {
          console.log(`Frame extraction warning: ${e.message}`);
        }
      }

      // Return existing frames
      const framePaths = [
        `${outputDir}/frame1.jpg`,
        `${outputDir}/frame2.jpg`, 
        `${outputDir}/frame3.jpg`
      ];

      return framePaths.filter(path => fs.existsSync(path));
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

    // Function to determine video format from folder path only
    function getVideoFormat(folderPath) {
      const pathLower = folderPath.toLowerCase();
      if (pathLower.includes('shorts')) return 'Shorts';
      return 'Long-form'; // Default to long-form
    }

    // Search for files from last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    console.log('Searching for files newer than:', twoHoursAgo);
    
    const response = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${twoHoursAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 3, // Reduced for video processing
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
      if (fileSizeGB > 1) { // Reduced size limit for video processing
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

      console.log(`🎬 Processing with AI visual analysis: ${file.name}`);

      try {
        // Download video file
        console.log('Downloading video...');
        const videoPath = await downloadFile(file.id, file.name);
        
        // Extract frames
        console.log('Extracting frames...');
        const frameDir = `/tmp/frames_${file.id}`;
        const framePaths = await extractFrames(videoPath, frameDir);
        
        console.log(`Extracted ${framePaths.length} frames`);

        if (framePaths.length === 0) {
          console.log('No frames extracted, skipping visual analysis');
          continue;
        }

        // Convert frames to base64
        const frames = framePaths.map(path => imageToBase64(path));

        // Build folder path for context
        let folderPath = 'Root';
        if (file.parents && file.parents.length > 0) {
          folderPath = await buildFolderPath(file.parents[0]);
          console.log(`Folder path: ${folderPath}`);
        }

        const projectType = getProjectTypeFromPath(folderPath);
        const videoFormat = getVideoFormat(folderPath);

        // AI visual analysis with comprehensive team/space training context
        console.log('Analyzing frames with Claude Vision...');
        
        const prompt = `Analyze these frames from a Switch and Click YouTube tech channel B-roll video.

TEAM MEMBER IDENTIFICATION:
- Jake: CEO, male, main host, typically appears in tech review scenarios, often at desk setups
- Betty: Head of Content, female, Jake's wife, often handles unboxing content, product demonstrations
- Tyson: Senior Writer, male, content creation focused
- Zack: Videographer, male, usually behind camera but may appear in setup/behind-scenes shots

LOCATION IDENTIFICATION:
- A-roll-room: Main filming space for talking head shots, professional lighting setup
- B-roll-room: Dedicated space for product shots, clean backgrounds, controlled lighting
- Office-space: Working desk environment, more casual setup, multiple monitors, keyboards
- Outdoors: Any exterior location, natural lighting
- Misc: Other locations not fitting above categories

ANALYSIS RULES:
- Analyze ONLY what you see in the video frames, ignore filename completely
- Focus on actual visible content: people, objects, actions, environment
- Be specific about tech products (don't just say "product")
- Look for unique environmental cues to identify filming location

Return JSON only:
{
  "people": ["Jake", "Betty", "Tyson", "Zack", "Hands-only", "Unknown"],
  "objects": ["specific tech products visible - be detailed"],
  "shot_type": "Close-up|Medium|Wide|Hands|Screen|Product",
  "action": ["specific actions you observe"],
  "location": "A-roll-room|B-roll-room|Office-space|Outdoors|Misc",
  "description": "Detailed description of what you actually see in the video frames",
  "best_for": ["specific use cases based on visual content"]
}

Base everything on visual analysis. Be specific about objects (e.g., "mechanical keyboard", "wireless mouse", "USB-C cable", "4K monitor") rather than generic terms.`;

        const messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...frames.slice(0, 3).map(frame => ({
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

        // Create Notion entry with visual analysis + folder path context in description
        await notion.pages.create({
          parent: { database_id: process.env.NOTION_DATABASE_ID },
          properties: {
            'Title': { title: [{ text: { content: displayTitle } }] },
            'Drive Link': { url: file.webViewLink },
            'Project Type': { select: { name: projectType } },
            'Video Format': { select: { name: videoFormat } },
            'People': { multi_select: analysis.people.map(p => ({ name: p })) },
            'Objects': { multi_select: analysis.objects.map(o => ({ name: o })) },
            'Shot Type': { select: { name: analysis.shot_type } },
            'Action': { multi_select: analysis.action.map(a => ({ name: a })) },
            'Location': { select: { name: analysis.location } },
            'Description': { rich_text: [{ text: { content: `${analysis.description} | Folder: ${folderPath} | Format: ${videoFormat}` } }] },
            'Best For': { multi_select: analysis.best_for.map(b => ({ name: b })) },
            'File Size (MB)': { number: Math.round(parseInt(file.size) / (1024 * 1024)) },
            'Processing Date': { date: { start: new Date().toISOString().split('T')[0] } }
          }
        });

        console.log(`✅ Created with visual AI analysis: ${displayTitle}`);
        processed++;

        // Cleanup temp files
        try {
          await execAsync(`rm -rf ${videoPath} ${frameDir}`);
        } catch (e) {
          console.log('Cleanup warning:', e.message);
        }

      } catch (videoError) {
        console.error(`Error processing video ${file.name}:`, videoError.message);
        // Skip if video processing fails
        continue;
      }
    }

    res.status(200).json({
      success: true,
      found: response.data.files.length,
      processed,
      message: `Successfully processed ${processed} new files with AI visual analysis`
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
