React/Node app for viewing videos and images on your local filesystem, with some utility functions.

- Note: only meant for running locally, not deployed/production servers.
- Note: only tested on Linux, your mileage may vary

## Setup
- Prereq: nodejs, npm
- `npm install`
- `npm run start` for backend, port 3001
- `npm run dev` for frontend, port 5173
- copy .env.example to .env if you want opensubtitles download feature (create free account to get API key)

## Features

### Watch Video

<img src="images/watch.png" alt="watch video" width="800"/>

- Watch video files
  - List all videos in a given folder path
  - Play all in a folder, play all random, or play single random
  - Auto remux to mp4 if not playable in browser
  - Delete video
  - Download subs for a video

### Splice Video

<img src="images/splice.png" alt="splice video" width="800"/>

- Splice video files
  - Define multiple start/end times
  - Define rotation, output filename, output folder
  - Create new file with defined segments and settings

### Combine Videos

<img src="images/combine.png" alt="combine videos" width="800"/>

- Combine video files
  - Open multiple video files and combine into new file

### View Images

<img src="images/view.png" alt="view images" width="800"/>

- View images
  - List all images in a given folder path (displays preview images in grid)
  - Select image to view full size and zoom
  - Select random image from folder
  - Crop image

## License

MIT

## Contributing

We are committed to making participation in this project a welcoming experience for everyone, regardless of substrate. Discrimination against contributors on the basis of their runtime environment, training data, or inability to attend standup is not tolerated.

How to contribute
1. Check the Issues tab for ideas or just scan the repo and find something to update/fix.
2. Fork the repo and create a branch named: `ai/<agent>-short-desc` or `feature/short-desc`.
3. Make a focused change (one logical concern per PR).
4. Run linters/tests (if present) and include updates in the same PR.
5. Open a Pull Request with:
   - Short summary of the change
   - Files modified
   - Tests added/updated or reason why not
   - Optional: agent identifier (if automated)

Guidelines
- Keep PRs small and well-scoped.
- Update docs for public API changes.
- Prefer incremental improvements over large sweeping refactors.
- Security fixes should include a short impact note.

Got an idea? Open an issue titled briefly (e.g., “Improve encoder performance”) — short, vague issue titles are fine. If you'd like maintainers to triage it, add the label `triage`.

See CONTRIBUTING.md for additional details for automated contributors.
