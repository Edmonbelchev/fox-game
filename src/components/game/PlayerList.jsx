import { useState, useEffect } from 'react';

export default function PlayerList({ players, gameStatus, currentUser }) {
  const [sortedPlayers, setSortedPlayers] = useState([]);

  useEffect(() => {
    const playerArray = Object.entries(players).map(([id, data]) => ({
      id,
      ...data
    }));
    setSortedPlayers(playerArray);
  }, [players]);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-xl font-bold mb-4">Players</h2>
      <div className="space-y-2">
        {sortedPlayers.map((player) => (
          <div
            key={player.id}
            className={`p-2 rounded ${
              player.id === currentUser.uid
                ? 'bg-blue-100'
                : 'bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{player.name}</span>
              {gameStatus === 'waiting' && (
                <span className={`text-sm ${
                  player.isReady ? 'text-green-500' : 'text-gray-500'
                }`}>
                  {player.isReady ? 'Ready' : 'Not Ready'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}