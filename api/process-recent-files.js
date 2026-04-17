import { google } from 'googleapis';
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const execAsync = promisify(exec);

// Helper function to add delays between API calls
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  try {
    console.log('=== PROCESSING RECENT FILES WITH OPTIMIZED FOLDER SEARCH ===');

    // Set up APIs
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    // 🚨 DEBUG MODE: Force fresh cache rebuild and unlimited depth scanning
    const cacheFile = '/tmp/folder-cache.json';
    
    let folderCache = [];
    
    console.log('🚨 DEBUG MODE: Force rebuilding cache with UNLIMITED depth scanning...');
    
    async function getAllSubfolders(parentId, allFolders = [], depth = 0) {
      if (depth >= 15) { // Safety limit increased to 15 levels
        console.log(`Reached safety max depth ${depth}, stopping recursion`);
        return allFolders;
      }

      try {
        // Faster rate limiting for debug mode
        await delay(100);
        
        const response = await drive.files.list({
          q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder'`,
          fields: 'files(id,name,parents)',
          pageSize: 100 // Increased page size
        });

        console.log(`🚨 DEBUG: Found ${response.data.files.length} folders at depth ${depth}`);

        for (const folder of response.data.files) {
          allFolders.push({id: folder.id, name: folder.name, depth});
          // Continue recursion for all levels
          await getAllSubfolders(folder.id, allFolders, depth + 1);
        }

        return allFolders;
      } catch (e) {
        console.log('Error getting subfolders:', e.message);
        return allFolders;
      }
    }

    const mainFolderId = '1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H';
    folderCache = await getAllSubfolders(mainFolderId);
    
    // Save to cache
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({
        timestamp: Date.now(),
        folders: folderCache
      }));
      console.log(`🚨 DEBUG: Built cache with ${folderCache.length} folders (UNLIMITED DEPTH)`);
      
      // Show folder distribution by depth
      const depthCounts = folderCache.reduce((acc, f) => {
        acc[f.depth] = (acc[f.depth] || 0) + 1;
        return acc;
      }, {});
      console.log('🚨 DEBUG: Folder distribution by depth:', depthCounts);
    } catch (e) {
      console.log('Cache write error:', e.message);
    }

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
      
      // Use the FFmpeg installer path for Vercel compatibility
      const commands = [
        `${ffmpeg.path} -i "${videoPath}" -ss 3 -vframes 1 "${outputDir}/frame1.jpg" -y`,
        `${ffmpeg.path} -i "${videoPath}" -ss 50% -vframes 1 "${outputDir}/frame2.jpg" -y`,
        `${ffmpeg.path} -i "${videoPath}" -ss 75% -vframes 1 "${outputDir}/frame3.jpg" -y`
      ];

      for (const cmd of commands) {
        try {
          await execAsync(cmd);
        } catch (e) {
          console.log(`Frame extraction warning: ${e.message}`);
        }
      }

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
      return 'Long-form';
    }

    // Search for recent files with 2-hour window
    // 🚨 DEBUG MODE: Extended 4-hour time window
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    console.log('🚨 DEBUG: Searching for files newer than:', fourHoursAgo, '(4 HOUR WINDOW)');

    // 🚨 DEBUG MODE: Search ALL folders with ROOT PRIORITIZED
    const rootFolder = {id: '1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H', name: 'ROOT_PRIORITY', depth: 0};
    
    const foldersToSearch = [
      rootFolder, // ROOT FOLDER FIRST!
      ...folderCache // ALL cached folders, no 30-folder limit
    ];

    console.log(`🚨 DEBUG: Searching ${foldersToSearch.length} folders (ROOT PRIORITIZED + ALL CACHED)...`);
    console.log(`🚨 DEBUG: Folders by depth:`, foldersToSearch.reduce((acc, f) => {
      acc[f.depth] = (acc[f.depth] || 0) + 1;
      return acc;
    }, {}));

    let allRecentFiles = [];

    // Search files with rate limiting instead of parallel
    for (const folder of foldersToSearch) {
      try {
        // 🚨 DEBUG: Faster delays for comprehensive search
        await delay(100);
        
        const response = await drive.files.list({
          q: `'${folder.id}' in parents and mimeType contains 'video' and createdTime > '${fourHoursAgo}'`,
          orderBy: 'createdTime desc',
          fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)',
          pageSize: 3 // Reduced from 5
        });
        
        const filesWithFolder = response.data.files.map(file => ({
          ...file,
          folderName: folder.name,
          folderId: folder.id
        }));
        
        allRecentFiles.push(...filesWithFolder);
      } catch (e) {
        console.log(`Error searching folder ${folder.name}:`, e.message);
        continue; // Skip failed folders instead of stopping
      }
    }

    // Remove duplicates and sort by creation time
    const uniqueFiles = allRecentFiles.filter((file, index, self) => 
      index === self.findIndex(f => f.id === file.id)
    ).sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

    console.log(`Found ${uniqueFiles.length} recent video files`);

    if (uniqueFiles.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No recent video files found',
        searchedSince: fourHoursAgo,
        foldersSearched: foldersToSearch.length,
        cacheUsed: false
      });
    }

    let processed = 0;

    // OPTIMIZED: Process up to 1 file per run to avoid timeouts
    for (const file of uniqueFiles.slice(0, 1)) {
      console.log(`Checking: ${file.name} in ${file.folderName}`);
      
      // UPDATED: 3GB file size limit as requested
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

        // AI visual analysis
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

        // Create Notion entry
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

        console.log(`✅ Created with visual AI analysis: ${displayTitle} from ${folderPath}`);
        processed++;

        // Cleanup temp files
        try {
          await execAsync(`rm -rf ${videoPath} ${frameDir}`);
        } catch (e) {
          console.log('Cleanup warning:', e.message);
        }

      } catch (videoError) {
        console.error(`Error processing video ${file.name}:`, videoError.message);
        continue;
      }
    }

    res.status(200).json({
      success: true,
      found: uniqueFiles.length,
      processed,
      foldersSearched: foldersToSearch.length,
      cacheUsed: false,
      message: `Successfully processed ${processed} new files with AI visual analysis (optimized search)`
    });

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
}
