# Guess the Song - Drinking Game

A Spotify-based local multiplayer drinking game.

## Prerequisites

### Node.js

This project requires **Node.js v16 or later**.

1. Download the installer from https://nodejs.org/
2. Run the installer and follow the prompts
3. Verify the installation by opening a terminal and running:
   ```
   node --version
   ```

### Spotify Developer App

1. Go to https://developer.spotify.com/dashboard and log in
2. Create a new app
3. Add `http://localhost:5173` as a Redirect URI in your app settings
4. Copy the **Client ID**

## Setup

1. Clone the repo and install dependencies:
   ```
   npm run install:all
   ```

2. Create `client/.env` (see `client/.env.example`):
   ```
   VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
   ```

3. Start the dev server:
   ```
   npm run dev
   ```

## Connecting

- **Host:** http://localhost:5173?role=host
- **Players:** http://\<LAN-IP\>:5173 (from phones/other devices on the same network)
