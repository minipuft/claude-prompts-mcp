# Video Frame Extractor

## Description
Downloads YouTube videos and extracts high-quality frames using FFmpeg for cinematography analysis, then cleans up the video file. Optimized for Windows compatibility and vault integration.

## User Message Template
**HIGH-QUALITY VIDEO FRAME EXTRACTION WORKFLOW**

Extract professional-quality frames from YouTube videos for cinematography analysis using FFmpeg.

**VIDEO URL:** {{video_url}}
**DOMAIN:** {{domain || "cinematography"}}
**TIMESTAMPS:** {{timestamps || "00:00:30,00:02:00,00:04:00,00:08:00"}}
**PROJECT NAME:** {{project_name || "video-analysis"}}

**EXECUTION WORKFLOW:**

**STEP 1: VIDEO DOWNLOAD**
- Use yt-dlp to download the video in 1080p quality
- Store temporarily in Downloads directory

**STEP 2: FRAME EXTRACTION**  
- Use FFmpeg to extract high-quality frames at specified timestamps
- Command format: `ffmpeg -i "video.webm" -ss HH:MM:SS -vframes 1 -q:v 2 "output.jpg"`
- Quality setting `-q:v 2` for maximum quality
- Extract frames at: {{timestamps}}

**STEP 3: FILE ORGANIZATION**
- Create `_media/{{domain}}/` directory if needed
- Rename files with descriptive, Windows-compatible names
- Format: `{{project_name}}-descriptive-name.jpg` (NO colons or special characters)
- Examples: 
  * `catopolis-opening-scene.jpg`
  * `catopolis-character-development.jpg`
  * `catopolis-domestic-warmth.jpg`

**STEP 4: CLEANUP**
- Delete the downloaded video file to save disk space
- Keep only the extracted high-quality frames

**STEP 5: VERIFICATION**
- Verify all extracted frames are readable and high quality
- Confirm Windows-compatible filenames
- Report final file locations and names

**QUALITY REQUIREMENTS:**
- Resolution: Maintain source quality (typically 1080p+)
- Format: JPEG with high quality compression
- Naming: Descriptive, Windows-compatible filenames
- Organization: Proper vault structure in `_media/{domain}/`

**OUTPUT DELIVERABLES:**
- High-quality extracted frames in proper directory
- Windows-compatible filenames
- Clean workspace (video deleted)
- File location report for integration into notes

Execute this workflow systematically, ensuring professional-quality frame extraction for cinematography analysis.
