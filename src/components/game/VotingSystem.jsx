import { useState } from 'react';
import { database } from '../../firebase/config';
import { ref, update } from 'firebase/database';
import { useAuth } from '../../contexts/AuthContext';

export default function VotingSystem({ gameId, players, onVotingComplete }) {
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const { currentUser } = useAuth();

  const submitVote = async () => {
    if (!selectedPlayer) return;

    const voteRef = ref(database, `games/${gameId}/votes/${currentUser.uid}`);
    await update(voteRef, {
      votedFor: selectedPlayer,
      timestamp: Date.now()
    });
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-xl font-bold mb-4">Vote for the Spy</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Object.entries(players).map(([playerId, player]) => (
          <button
            key={playerId}
            onClick={() => setSelectedPlayer(playerId)}
            className={`p-3 rounded-lg ${
              selectedPlayer === playerId
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
            disabled={playerId === currentUser.uid}
          >
            {player.name}
          </button>
        ))}
      </div>

      <button
        onClick={submitVote}
        disabled={!selectedPlayer}
        className="mt-4 w-full bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-300"
      >
        Submit Vote
      </button>
    </div>
  );
}