import React from 'react';
import type { Player } from '../types/game';

interface Props {
  scores: Player[];
  myName?: string;
}

export default function Leaderboard({ scores, myName }: Props) {
  return (
    <div className="leaderboard">
      <h2>Final Scores</h2>
      {scores.map((player, index) => {
        const isFirst = index === 0;
        const isLast = index === scores.length - 1 && scores.length > 1;
        const isMe = player.name === myName;

        return (
          <div
            key={index}
            className={[
              'leaderboard-row',
              isFirst ? 'first-place' : '',
              isLast ? 'last-place' : '',
              isMe ? 'me' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="rank">
              {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
            </span>
            <span className="name">
              {player.name}
              {isMe ? ' (you)' : ''}
            </span>
            <span className="score">{player.score} pts</span>
            {isLast && <span className="drink">🍺 Drink up!</span>}
          </div>
        );
      })}
    </div>
  );
}
