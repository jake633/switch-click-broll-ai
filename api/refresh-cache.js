import fs from 'fs';

export default async function handler(req, res) {
  try {
    const cacheFile = '/tmp/folder-cache.json';
    
    // Delete cache file to force refresh
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      console.log('Cache file deleted');
    }

    res.status(200).json({
      success: true,
      message: 'Folder cache cleared. Next processing run will rebuild the cache with new project folders.'
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      message: 'Failed to clear cache'
    });
  }
}
