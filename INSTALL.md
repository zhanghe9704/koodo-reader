# Installing and Building Koodo Reader

This guide explains how to install dependencies, build, and integrate Koodo Reader into the WebApps platform.

## Prerequisites

- Node.js (version 20 or higher)
- npm or yarn package manager

## Installation Steps

1. Navigate to the Koodo Reader directory:
   ```bash
   cd /mnt/d/Work/Code/WebApps/koodo-reader
   ```

2. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   # OR
   yarn install
   ```

3. Build the application:
   ```bash
   npm run build
   # OR
   yarn build
   ```

## Integration with WebApps Platform

Once built successfully, the Koodo Reader will be available in the `/koodo` route of the main application. The build process creates a `build` directory with all necessary assets.

## Troubleshooting

- If you encounter dependency conflicts, use `--legacy-peer-deps` flag with npm
- Make sure you have sufficient disk space for node_modules (~500MB+)
- If build fails due to memory issues, try increasing Node's memory limit:
  ```bash
  NODE_OPTIONS="--max-old-space-size=4096" npm run build
  ```
  
## Development Mode

For development/testing locally:
```bash
npm start
```

Note: For production deployment within the WebApps platform, only the built version in the `build` directory is used.