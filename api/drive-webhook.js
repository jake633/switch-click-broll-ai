export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Pub/Sub sends base64 encoded data
    const pubsubMessage = req.body;
    const data = pubsubMessage.message?.data;
    
    if (!data) {
      return res.status(400).json({ error: 'No message data' });
    }

    // Decode the message
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());
    
    // Extract file info from Drive API notification
    const { fileId, fileName, mimeType, size } = messageData;
    
    // Filter: Only process video files under 3GB
    const videoMimeTypes = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
    const maxSizeBytes = 3 * 1024 * 1024 * 1024; // 3GB
    
    if (!videoMimeTypes.includes(mimeType)) {
      console.log(`Skipping non-video file: ${fileName}`);
      return res.status(200).json({ message: 'Non-video file skipped' });
    }
    
    if (parseInt(size) > maxSizeBytes) {
      console.log(`Skipping large file: ${fileName} (${size} bytes)`);
      return res.status(200).json({ message: 'Large file skipped' });
    }
    
    // Log the file we're going to process
    console.log(`Processing video: ${fileName} (${size} bytes)`);
    
    // TODO: Queue for video processing
    // await processVideo(fileId, fileName);
    
    res.status(200).json({ 
      success: true, 
      message: `Queued ${fileName} for processing` 
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
