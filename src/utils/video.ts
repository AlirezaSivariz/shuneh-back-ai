import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

/** Extract the first frame as a JPEG buffer for thumbnail. */
export function extractThumbnail(videoPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    ffmpeg(videoPath)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
      .outputOption('-frames:v 1')
      .outputFormat('image2pipe')
      .noAudio()
      .pipe()
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('error', reject);
  });
}

/** Get video duration in seconds. */
export function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format?.duration ?? 0);
    });
  });
}

interface ProcessOptions {
  // reserved for future use
}

/**
 * Resize video to 720p max, H.264+AAC, faststart.
 * Returns the output path on completion.
 */
export function processVideo(
  inputPath: string,
  outputPath: string,
  _opts?: ProcessOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate(128)
      .outputOption('-preset fast')
      .outputOption('-movflags +faststart')
      .outputOption('-vf', "scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease")
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}
