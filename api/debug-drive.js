import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    // Set up Google Drive API
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth });

    // Get ALL files from the last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    const allFiles = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and createdTime > '${fourHoursAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 20,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    const videoFiles = await drive.files.list({
      q: `'1k5IHIoJnFKf1k3yv0bq6wkJfskKn6w_H' in parents and mimeType contains 'video' and createdTime > '${fourHoursAgo}'`,
      orderBy: 'createdTime desc',
      pageSize: 20,
      fields: 'files(id,name,size,mimeType,webViewLink,parents,createdTime)'
    });

    res.status(200).json({
      success: true,
      searchedSince: fourHoursAgo,
      allFiles: allFiles.data.files.map(f => ({
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        created: f.createdTime,
        id: f.id
      })),
      videoFiles: videoFiles.data.files.map(f => ({
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        created: f.createdTime,
        id: f.id
      })),
      totals: {
        allFiles: allFiles.data.files.length,
        videoFiles: videoFiles.data.files.length
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message, details: error.stack });
  }
}
