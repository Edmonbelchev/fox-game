import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { database } from '../../firebase/config';
import { ref, onValue, update, remove, push } from 'firebase/database';
import { useAuth } from '../../contexts/AuthContext';
import Avatar from '../common/Avatar';
import VoiceChat from './VoiceChat';

// Game categories and locations
const categories = {
  'Travel': [
    'Airport', 'Beach', 'Hotel', 'Train Station', 'Camping Site',
    'Cruise Ship', 'Museum', 'Tourist Attraction', 'Mountain Resort'
  ],
  'Entertainment': [
    'Movie Theater', 'Concert Hall', 'Casino', 'Theme Park',
    'Circus', 'Theater', 'Night Club', 'Arcade', 'Zoo'
  ],
  'Public Places': [
    'Hospital', 'School', 'Bank', 'Library', 'Shopping Mall',
    'Restaurant', 'Park', 'Gym', 'Church', 'Police Station'
  ],
  'Work Places': [
    'Office', 'Factory', 'Construction Site', 'Restaurant Kitchen',
    'Police Station', 'Fire Station', 'Post Office', 'Laboratory', 'Studio'
  ],
  'Sports': [
    'Football Stadium', 'Basketball Court', 'Swimming Pool', 'Tennis Court',
    'Golf Course', 'Ice Rink', 'Bowling Alley', 'Yoga Studio', 'Ski Resort'
  ]
};

export default function GameRoom() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  // Game state
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");

  useEffect(() => {
    if (!gameId || !currentUser) {
      navigate("/");
      return;
    }

    const gameRef = ref(database, `games/${gameId}`);
    let isSubscribed = true;

    const unsubscribe = onValue(gameRef, async (snapshot) => {
      if (!isSubscribed) return;

      const gameData = snapshot.val();

      if (!gameData) {
        setError("Game not found");
        setLoading(false);
        return;
      }

      // Check if player is host
      const isPlayerHost = gameData.host === currentUser.uid;
      setIsHost(isPlayerHost);

      // If player is not in the game, add them
      if (!gameData.players?.[currentUser.uid]) {
        const playerRef = ref(
          database,
          `games/${gameId}/players/${currentUser.uid}`
        );
        try {
          await update(playerRef, {
            name: currentUser.displayName || currentUser.email,
            email: currentUser.email,
            photoURL: currentUser.photoURL,
            isReady: false,
            isHost: isPlayerHost,
            joinedAt: Date.now(),
          });
        } catch (error) {
          console.error("Error joining game:", error);
        }
      }

      setGame(gameData);
      setGameStarted(gameData.status === "playing");
      setLoading(false);
    });

    // Listen for messages
    const messagesRef = ref(database, `games/${gameId}/messages`);
    const messagesUnsubscribe = onValue(messagesRef, (snapshot) => {
      if (!isSubscribed) return;

      const messagesData = snapshot.val();
      if (messagesData) {
        const messagesList = Object.values(messagesData);
        setMessages(messagesList.sort((a, b) => a.timestamp - b.timestamp));
      }
    });

    // Cleanup function
    return () => {
      isSubscribed = false;
      unsubscribe();
      messagesUnsubscribe();
      if (game && currentUser) {
        const playerRef = ref(
          database,
          `games/${gameId}/players/${currentUser.uid}`
        );
        remove(playerRef).catch(console.error);
      }
    };
  }, [gameId, currentUser, navigate]);

  const startGame = async () => {
    if (!game || !isHost || !selectedCategory) return;

    const playerIds = Object.keys(game.players);
    const randomSpy = playerIds[Math.floor(Math.random() * playerIds.length)];
    const categoryLocations = categories[selectedCategory];
    const randomLocation =
      categoryLocations[Math.floor(Math.random() * categoryLocations.length)];

    const gameRef = ref(database, `games/${gameId}`);
    try {
      await update(gameRef, {
        status: "playing",
        currentRound: {
          spy: randomSpy,
          location: randomLocation,
          category: selectedCategory,
          startedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error("Error starting game:", error);
    }
  };

  const toggleReady = async () => {
    if (!game || !currentUser) return;

    const playerRef = ref(
      database,
      `games/${gameId}/players/${currentUser.uid}`
    );
    try {
      await update(playerRef, {
        isReady: !game.players[currentUser.uid].isReady,
      });
    } catch (error) {
      console.error("Error toggling ready state:", error);
    }
  };

  const leaveGame = async () => {
    if (!gameId || !currentUser) return;

    try {
      if (isHost) {
        const gameRef = ref(database, `games/${gameId}`);
        await remove(gameRef);
      } else {
        const playerRef = ref(
          database,
          `games/${gameId}/players/${currentUser.uid}`
        );
        await remove(playerRef);
      }

      navigate("/");
    } catch (error) {
      console.error("Error leaving game:", error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser) return;

    const messagesRef = ref(database, `games/${gameId}/messages`);
    try {
      await push(messagesRef, {
        text: newMessage,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        userPhoto: currentUser.photoURL,
        timestamp: Date.now(),
      });
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };
  // ... continuing from Part 1

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!game) return <div>Game not found</div>;

  const playerCount = Object.keys(game.players).length;
  const minPlayers = game.settings?.minPlayers || 3;
  const readyPlayers = Object.values(game.players).reduce(
    (count, player) => count + (player.isHost || player.isReady ? 1 : 0),
    0
  );
  const nonHostPlayersReady = Object.values(game.players).every(
    (player) => player.isHost || player.isReady
  );
  const canStartGame = playerCount >= minPlayers && nonHostPlayersReady;

  return (
    <div className="container mx-auto p-4">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Game Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Game Room</h1>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    Players: {playerCount} / {game.settings?.maxPlayers || 8}
                  </span>
                  <span className="px-2 py-1 rounded text-sm bg-yellow-100 text-yellow-800">
                    {gameStarted ? "Playing" : "Waiting"}
                  </span>
                </div>
              </div>

              {gameStarted ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-blue-50">
                    <h2 className="text-lg font-semibold mb-2">Your Role:</h2>
                    <p className="text-xl font-bold mb-2">
                      You are{" "}
                      {game.currentRound?.spy === currentUser.uid
                        ? "the Spy!"
                        : "a Player"}
                    </p>
                    {game.currentRound?.spy !== currentUser.uid && (
                      <>
                        <p className="text-md mb-1">
                          Category: {game.currentRound?.category}
                        </p>
                        <p className="text-md">
                          Location:{" "}
                          <strong>{game.currentRound?.location}</strong>
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Players List */}
                  <div className="grid gap-4 md:grid-cols-2 mb-6">
                    {Object.entries(game.players).map(([playerId, player]) => (
                      <div
                        key={playerId}
                        className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg"
                      >
                        <Avatar
                          user={{
                            displayName: player.name,
                            email: player.email,
                            photoURL: player.photoURL,
                          }}
                          size="md"
                        />
                        <div className="flex-1">
                          <div className="font-medium">{player.name}</div>
                          <div className="text-sm text-gray-500">
                            {player.isHost ? "Host" : "Player"}
                          </div>
                        </div>
                        <div
                          className={`px-2 py-1 rounded text-sm ${
                            player.isHost || player.isReady
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {player.isHost
                            ? "Host"
                            : player.isReady
                            ? "Ready"
                            : "Not Ready"}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Game Controls */}
                  <div className="flex flex-col space-y-4">
                    {isHost && (
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <h3 className="text-lg font-semibold mb-3">
                          Game Settings
                        </h3>
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Select Category:
                          </label>
                          <select
                            value={selectedCategory || ""}
                            onChange={(e) =>
                              setSelectedCategory(e.target.value)
                            }
                            className="w-full p-2 border rounded-md"
                          >
                            <option value="">Choose a category...</option>
                            {Object.keys(categories).map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between items-center">
                      <div className="space-x-4">
                        {!isHost && (
                          <button
                            onClick={toggleReady}
                            className={`px-6 py-2 rounded-lg text-white transition ${
                              game.players[currentUser.uid]?.isReady
                                ? "bg-yellow-500 hover:bg-yellow-600"
                                : "bg-green-500 hover:bg-green-600"
                            }`}
                          >
                            {game.players[currentUser.uid]?.isReady
                              ? "Not Ready"
                              : "Ready"}
                          </button>
                        )}
                        <button
                          onClick={leaveGame}
                          className="px-6 py-2 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition"
                        >
                          Leave Room
                        </button>
                      </div>

                      {isHost && (
                        <button
                          onClick={startGame}
                          disabled={!canStartGame || !selectedCategory}
                          className={`px-6 py-2 rounded-lg text-white transition ${
                            canStartGame && selectedCategory
                              ? "bg-blue-500 hover:bg-blue-600"
                              : "bg-gray-400 cursor-not-allowed"
                          }`}
                        >
                          Start Game
                        </button>
                      )}
                    </div>

                    {/* Game Status Messages */}
                    {isHost && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm text-gray-500">
                          Players Ready: {readyPlayers} / {playerCount}{" "}
                          (including you as host)
                        </p>
                        {!selectedCategory && (
                          <p className="text-sm text-yellow-600">
                            Please select a category to start the game
                          </p>
                        )}
                        {playerCount < minPlayers && (
                          <p className="text-sm text-gray-500">
                            Need at least {minPlayers} players to start...
                          </p>
                        )}
                        {playerCount >= minPlayers && !nonHostPlayersReady && (
                          <p className="text-sm text-gray-500">
                            Waiting for all players to be ready...
                          </p>
                        )}
                        {canStartGame && selectedCategory && (
                          <p className="text-sm text-green-500">
                            All set! You can start the game.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Chat and Voice Panel */}
          <div className="space-y-4">
            {/* Voice Chat */}
            <VoiceChat gameId={gameId} currentUser={currentUser} />

            {/* Text Chat */}
            <div className="bg-white rounded-lg shadow-md h-[400px] flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex items-start space-x-3 ${
                      message.userId === currentUser.uid ? "justify-end" : ""
                    }`}
                  >
                    {message.userId !== currentUser.uid && (
                      <Avatar
                        user={{
                          displayName: message.userName,
                          photoURL: message.userPhoto,
                        }}
                        size="sm"
                      />
                    )}
                    <div
                      className={`flex flex-col ${
                        message.userId === currentUser.uid
                          ? "items-end"
                          : "items-start"
                      }`}
                    >
                      <span className="text-xs text-gray-500">
                        {message.userName}
                      </span>
                      <div
                        className={`px-4 py-2 rounded-lg ${
                          message.userId === currentUser.uid
                            ? "bg-blue-500 text-white"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {message.text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <form
                onSubmit={sendMessage}
                className="p-4 bg-gray-100 rounded-b-lg"
              >
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 rounded border border-gray-300 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}