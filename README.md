React/Node app for viewing videos and images on your local filesystem, with some utility functions.

- Note: only meant for running locally, not deployed/production servers.
- Note: only tested on Linux, your milage may vary

# Setup
- Prereq: nodejs, npm
- `npm install`
- `npm run start` for backend, port 3001
- `npm run dev` for frontend, port 5173
- copy .env.example to .env if you want opensubtitles download feature (create free account to get API key)

# Screenshots

Watch Video

<img src="images/watch.png" alt="watch video" width="800"/>

Splice Video

<img src="images/splice.png" alt="splice video" width="800"/>

Combine Videos

<img src="images/combine.png" alt="combine videos" width="800"/>

View Images

<img src="images/view.png" alt="view images" width="800"/>

# Features
- Watch video files
  - List all videos in a given folder path
  - Play all in a folder, play all random, or play single random
  - Auto remux to mp4 if not playable in browser
  - Delete video
  - Download subs for a video
- Splice video files
  - Define multiple start/end times
  - Define rotation, output filename, output folder
  - Create new file with defined segments and settings
- Combine video files
  - Open multiple video files and combine into new file
- View images
  - List all images in a given folder path (displays preview images in grid)
  - Select image to view full size and zoom
  - Select random image from folder
  - Crop image

# License
MIT