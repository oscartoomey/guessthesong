import React from 'react';
import HostView from './components/HostView';
import PlayerView from './components/PlayerView';
import './App.css';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  // A ?code= param means Spotify OAuth callback — only the host authenticates
  const isHost = params.get('role') === 'host' || params.has('code');

  return (
    <div className="app">
      {isHost ? <HostView /> : <PlayerView />}
    </div>
  );
}
