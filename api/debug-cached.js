import { google } from 'googleapis';
import fs from 'fs';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });

    const cacheFile = '/tmp/folder-cache.json';
    const cacheMaxAge = 30 * 60 * 1000; // 30 minutes
    
    let folderCache = null;
    let useCache = false;

    // Try to load existing cache
    if (fs.existsSync(cacheFile)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const cacheAge = Date.now() - cacheData.timestamp;
        
        if (cacheAge < cacheMaxAge) {
          folderCache = cacheData.folders;
          useCache = true;
          console.log(`Using cached folder data (${Math.round(cacheAge/1000/60)} minutes old)`);
        }
      } catch (e) {
        console.log('Cache read error:', e.message);
      }
    }

    // Build new cache if needed
    if (!useCache) {
      console.log('Building new folder cache...');
      
      async function getAllSubfolders(parentId, allFolders = [], depth = 0) {
        try {
          const response = await drive.files.list({
            q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder'`,
            fields: 'files(id,name,parents)',
            pageSize: 100
          });

          for (const folder of response.data.files) {
            allFolders.push({id: folder.id, name: folder.name, depth});
            if (depth < 5) {
              await getAllSubfolders(folder.id, allFolders, depth + 1);
            }
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
        console.log(`Cached ${folderCache.length} folders`);
      } catch (e) {
        console.log('Cache write error:', e.message);
      }
    }

    // Now quickly search for files
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    let allFiles = [];
    
    const foldersToSearch = [
      {id: '1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H', name: 'Root', depth: 0},
      ...folderCache
    ];

    console.log(`Searching ${foldersToSearch.length} folders for recent files...`);

    // Search files in parallel (faster)
    const searchPromises = foldersToSearch.map(async folder => {
      try {
        const response = await drive.files.list({
          q: `'${folder.id}' in parents and mimeType contains 'video' and createdTime > '${fourHoursAgo}'`,
          fields: 'files(id,name,size,mimeType,parents,createdTime)',
          pageSize: 10
        });
        
        return response.data.files.map(file => ({
          ...file,
          folderName: folder.name,
          folderId: folder.id,
          depth: folder.depth
        }));
      } catch (e) {
        console.log(`Error searching folder ${folder.name}:`, e.message);
        return [];
      }
    });

    const searchResults = await Promise.all(searchPromises);
    allFiles = searchResults.flat();

    res.status(200).json({
      success: true,
      cacheUsed: useCache,
      searchedSince: fourHoursAgo,
      foldersSearched: foldersToSearch.length,
      videoFiles: allFiles.map(f => ({
        name: f.name,
        folderName: f.folderName,
        depth: f.depth,
        size: Math.round(parseInt(f.size) / (1024 * 1024)) + 'MB',
        created: f.createdTime
      })),
      totalVideoFiles: allFiles.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
