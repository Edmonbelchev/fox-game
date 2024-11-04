import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { database } from '../../firebase/config';
import { ref, push, set, get } from 'firebase/database';
import { useAuth } from '../../contexts/AuthContext';
import Avatar from '../common/Avatar';

export default function GameLobby() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Test database connection on component mount
  useEffect(() => {
    const testConnection = async () => {
      try {
        const testRef = ref(database, 'test');
        await set(testRef, {
          timestamp: Date.now(),
          test: true
        });
        const snapshot = await get(testRef);
        console.log('Database connection test:', snapshot.exists() ? 'successful' : 'failed');
      } catch (error) {
        console.error('Database connection test failed:', error);
        setError('Failed to connect to database: ' + error.message);
      }
    };

    testConnection();
  }, []);

  const createGame = async () => {
  try {
    setLoading(true);
    setError(null);
    console.log('Creating new game for user:', currentUser.uid);
    
    const gamesRef = ref(database, 'games');
    const newGameRef = push(gamesRef);
    const gameId = newGameRef.key;
    
    console.log('Generated game ID:', gameId);

    const gameData = {
      id: gameId,
      host: currentUser.uid, // Set host ID
      hostName: currentUser.displayName || currentUser.email,
      hostPhotoURL: currentUser.photoURL,
      status: 'waiting',
      createdAt: Date.now(),
      players: {
        [currentUser.uid]: {  // Add host as first player
          name: currentUser.displayName || currentUser.email,
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          isReady: true,  // Host is automatically ready
          isHost: true,   // Explicitly set isHost to true
          joinedAt: Date.now()
        }
      },
      settings: {
        maxPlayers: 8,
        minPlayers: 3,
        category: 'Locations'
      }
    };

    // Save the game data
    console.log('Saving game data:', gameData);
    await set(newGameRef, gameData);
    console.log('Game created successfully');

    // Copy game URL to clipboard
    const gameUrl = `${window.location.origin}/game/${gameId}`;
    await navigator.clipboard.writeText(gameUrl);
    
    navigate(`/game/${gameId}`);
    
  } catch (error) {
    console.error('Error creating game:', error);
    setError(error.message);
  } finally {
    setLoading(false);
  }
};

  // Rest of the component remains the same...
  if (!currentUser) {
    return (
      <div className="container mx-auto p-4">
        <div className="text-center py-8 bg-white rounded-lg shadow">
          <p className="text-gray-600">Please log in to access the game lobby.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="max-w-2xl mx-auto">
        {/* Current User Profile */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center space-x-4">
            <Avatar user={currentUser} size="lg" />
            <div>
              <h2 className="text-xl font-bold">
                {currentUser.displayName || currentUser.email}
              </h2>
              <p className="text-gray-600">
                {currentUser.displayName ? currentUser.email : 'No display name set'}
              </p>
            </div>
          </div>
        </div>

        {/* Create Game Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Create New Game</h2>
          <p className="text-gray-600 mb-6">
            Create a new game and share the link with your friends to play together.
          </p>
          
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          <button
            onClick={createGame}
            disabled={loading}
            className={`w-full py-3 px-6 rounded-lg text-white text-lg font-medium transition ${
              loading 
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Creating Game...</span>
              </div>
            ) : (
              'Create New Game'
            )}
          </button>
          
          <p className="text-sm text-gray-500 mt-4 text-center">
            The game link will be automatically copied to your clipboard when created.
          </p>
        </div>

        {/* How to Play */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold mb-4">How to Play</h2>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-500 rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-medium">Create a Game</h3>
                <p className="text-gray-600">Click the "Create New Game" button above to start a new game.</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-500 rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-medium">Share the Link</h3>
                <p className="text-gray-600">Share the game link with your friends (it will be copied to your clipboard automatically).</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-500 rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-medium">Wait for Players</h3>
                <p className="text-gray-600">Wait for your friends to join using the link you shared.</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-500 rounded-full flex items-center justify-center font-bold">
                4
              </div>
              <div>
                <h3 className="font-medium">Start the Game</h3>
                <p className="text-gray-600">Once everyone is ready, the host can start the game!</p>
              </div>
            </div>
          </div>
        </div>

        {/* Debug Info */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-bold mb-2">Debug Info:</h3>
          <pre className="text-xs overflow-auto">
            {JSON.stringify({
              currentUser: {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName
              },
              databaseURL: database.app.options.databaseURL,
              loading,
              error
            }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}