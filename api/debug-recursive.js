import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });

    // Recursive function to get all folders
    async function getAllSubfolders(parentId, allFolders = [], depth = 0) {
      try {
        console.log(`Searching depth ${depth} under ${parentId}`);
        const response = await drive.files.list({
          q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder'`,
          fields: 'files(id,name,parents)',
          pageSize: 100
        });

        console.log(`Found ${response.data.files.length} folders at depth ${depth}`);

        for (const folder of response.data.files) {
          allFolders.push({id: folder.id, name: folder.name, depth});
          // Recursively get subfolders (limit depth to prevent infinite loops)
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
    const allFolders = await getAllSubfolders(mainFolderId);
    
    // Search last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    let allFiles = [];
    
    // Search main folder
    const mainResponse = await drive.files.list({
      q: `'${mainFolderId}' in parents and mimeType contains 'video' and createdTime > '${fourHoursAgo}'`,
      fields: 'files(id,name,size,mimeType,parents,createdTime)',
      pageSize: 20
    });
    
    mainResponse.data.files.forEach(file => {
      allFiles.push({...file, folderName: 'Root', folderId: mainFolderId});
    });

    // Search each subfolder
    for (const folder of allFolders) {
      try {
        const response = await drive.files.list({
          q: `'${folder.id}' in parents and mimeType contains 'video' and createdTime > '${fourHoursAgo}'`,
          fields: 'files(id,name,size,mimeType,parents,createdTime)',
          pageSize: 20
        });
        
        response.data.files.forEach(file => {
          allFiles.push({...file, folderName: folder.name, folderId: folder.id, depth: folder.depth});
        });
      } catch (e) {
        console.log(`Error searching folder ${folder.name}:`, e.message);
      }
    }

    res.status(200).json({
      success: true,
      searchedSince: fourHoursAgo,
      foldersFound: allFolders.length,
      folders: allFolders,
      videoFiles: allFiles.map(f => ({
        name: f.name,
        folderName: f.folderName,
        depth: f.depth,
        size: Math.round(parseInt(f.size) / (1024 * 1024)) + 'MB',
        created: f.createdTime,
        parents: f.parents
      })),
      totalVideoFiles: allFiles.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message, details: error.stack });
  }
}
