import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { database } from '../../firebase/config';
import { ref, onValue, update, remove, push, set } from 'firebase/database';
import { useAuth } from '../../contexts/AuthContext';
import Avatar from '../common/Avatar';
import VoiceChat from './VoiceChat';
import GameChat from './GameChat';

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

  // Time management states
  const [selectedTime, setSelectedTime] = useState('3'); // Default 3 minutes
  const [timeLeft, setTimeLeft] = useState(null);
  const [gameStartTime, setGameStartTime] = useState(null);

  // Add this state near the other state declarations
  const [showVotingPopup, setShowVotingPopup] = useState(false);
  const [votes, setVotes] = useState({});
  const [votingResult, setVotingResult] = useState(null);

  // Add these new states
  const [voteCallRequests, setVoteCallRequests] = useState({});
  const [showVoteCallButton, setShowVoteCallButton] = useState(true);

  // Add this state for tracking eliminated players
  const [eliminatedPlayers, setEliminatedPlayers] = useState({});

  // Add state to track voting phase
  const [votingPhase, setVotingPhase] = useState('none'); // 'none', 'voting', 'result'

  // Add new state for tracking players who want to play again
  const [playAgainPlayers, setPlayAgainPlayers] = useState({});

  // Add this state at the top of your component
  const [showEndGamePopup, setShowEndGamePopup] = useState(true);

  // Create a separate EndGamePopup component
  const EndGamePopup = ({ game, currentUser, votingResult, playAgainPlayers, onPlayAgain, onReturn }) => {
    if (!showEndGamePopup) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-2xl font-bold mb-4">
            {game.winner === 'spy' ? 'Spy Wins!' : 'Players Win!'}
          </h2>
          
          <p className="mb-4">
            {game.players[votingResult.votedPlayer]?.name} was voted out.
            {votingResult.isSpy ? ' They were the spy!' : ' They were not the spy!'}
          </p>

          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <h3 className="font-semibold mb-2">Players Ready for Next Game:</h3>
            <div className="space-y-1">
              {Object.entries(game.players).map(([playerId, player]) => (
                <div key={playerId} className="flex items-center space-x-2">
                  <span className={playAgainPlayers[playerId] ? 'text-green-600' : 'text-gray-400'}>
                    ●
                  </span>
                  <span>
                    {player.name}
                    {playerId === currentUser.uid && ' (You)'}
                    {player.isHost && ' (Host)'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {game.players[currentUser.uid].isHost ? (
              <button
                onClick={onPlayAgain}
                disabled={Object.keys(playAgainPlayers).length < 2}
                className={`w-full py-2 rounded ${
                  Object.keys(playAgainPlayers).length < 2
                    ? 'bg-gray-200 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                Start New Game ({Object.keys(playAgainPlayers).length + 1} players)
              </button>
            ) : (
              <button
                onClick={onPlayAgain}
                disabled={playAgainPlayers[currentUser?.uid]}
                className={`w-full py-2 rounded ${
                  playAgainPlayers[currentUser?.uid]
                    ? 'bg-green-200 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {playAgainPlayers[currentUser?.uid] ? 'Waiting for Host...' : 'Play Again'}
              </button>
            )}
            
            <button
              onClick={onReturn}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white py-2 rounded"
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Add effect to track play again requests
  useEffect(() => {
    if (!gameId || !game?.status === 'ended') return;

    const playAgainRef = ref(database, `games/${gameId}/playAgainRequests`);
    const unsubscribe = onValue(playAgainRef, (snapshot) => {
      const requests = snapshot.val() || {};
      setPlayAgainPlayers(requests);
      console.log('Play again requests:', requests); // Debug log
    });

    return () => unsubscribe();
  }, [gameId, game?.status]);

  // Handle Play Again button click
  const handlePlayAgain = async () => {
    if (!currentUser?.uid || !gameId) return;

    try {
      if (game.players[currentUser.uid].isHost) {
        // Hide popup immediately when host creates new game
        setShowEndGamePopup(false);
        setVotingPhase('none');
        setVotingResult(null);

        // Create new game room
        const newGameRef = push(ref(database, 'games'));
        const newGameId = newGameRef.key;

        // Get all players who want to play again
        const playersForNewGame = {};
        
        // Add host first
        playersForNewGame[currentUser.uid] = {
          name: currentUser.displayName || currentUser.email,
          email: currentUser.email || '',
          photoURL: currentUser.photoURL || null,
          isReady: false,
          isHost: true
        };

        // Add all players who clicked play again
        Object.keys(playAgainPlayers).forEach((playerId) => {
          if (playerId !== currentUser.uid) {
            const player = game.players[playerId];
            playersForNewGame[playerId] = {
              name: player.name || player.email || 'Unknown Player',
              email: player.email || '',
              photoURL: player.photoURL || null,
              isReady: false,
              isHost: false
            };
          }
        });

        // Set up new game
        const newGameData = {
          host: currentUser.uid,
          players: playersForNewGame,
          status: 'waiting',
          settings: {
            maxPlayers: game.settings?.maxPlayers || 8,
            minPlayers: game.settings?.minPlayers || 3,
            ...(game.settings || {})
          },
          createdAt: Date.now()
        };

        // Create new game and update old game atomically
        const updates = {};
        updates[`/games/${newGameId}`] = newGameData;
        updates[`/games/${gameId}/redirectTo`] = newGameId;
        updates[`/games/${gameId}/status`] = 'redirecting'; // Add status to prevent popup from showing
        
        const dbRef = ref(database);
        await update(dbRef, updates);

      } else {
        // Non-host players mark themselves as ready
        const playAgainRef = ref(database, `games/${gameId}/playAgainRequests/${currentUser.uid}`);
        await set(playAgainRef, {
          timestamp: Date.now(),
          playerName: currentUser.displayName || currentUser.email,
          photoURL: currentUser.photoURL || null
        });
      }
    } catch (error) {
      console.error("Error handling play again:", error);
    }
  };

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

    // Cleanup function
    return () => {
      isSubscribed = false;
      unsubscribe();
      if (game && currentUser) {
        const playerRef = ref(
          database,
          `games/${gameId}/players/${currentUser.uid}`
        );
        remove(playerRef).catch(console.error);
      }
    };
  }, [gameId, currentUser, navigate]);

  // Timer effect
  useEffect(() => {
    if (!game?.currentRound?.startedAt || !game?.currentRound?.timeLimit) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const startTime = game.currentRound.startedAt;
      const timeLimit = game.currentRound.timeLimit;
      const elapsed = Math.floor((now - startTime) / 1000);
      const remaining = timeLimit - elapsed;

      if (remaining <= 0) {
        clearInterval(timer);
        setTimeLeft(0);
        setShowVotingPopup(true); // Show voting popup when time runs out
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [game?.currentRound]);

  // Add these new functions for voting
  const castVote = async (votedPlayerId) => {
    const voteRef = ref(database, `games/${gameId}/votes/${currentUser.uid}`);
    await update(voteRef, {
      votedFor: votedPlayerId,
      votedBy: currentUser.uid,
      voterName: currentUser.displayName || currentUser.email
    });
    setShowVotingPopup(false);
  };

  // Add this effect to listen for votes
  useEffect(() => {
    if (!gameId || !game) return;

    const votesRef = ref(database, `games/${gameId}/votes`);
    const unsubscribe = onValue(votesRef, (snapshot) => {
      const votesData = snapshot.val() || {};
      setVotes(votesData);

      // Check if everyone has voted
      if (game?.players) {
        // Count only non-eliminated players
        const activePlayers = Object.keys(game.players).filter(
          playerId => !eliminatedPlayers[playerId]
        );
        const totalVotes = Object.keys(votesData).filter(
          voterId => !eliminatedPlayers[voterId]
        ).length;

        if (totalVotes === activePlayers.length) {
          handleVotingComplete(votesData);
        }
      }
    });

    return () => unsubscribe();
  }, [gameId, game, eliminatedPlayers]);

  // Add function to check for spy win condition
  const checkSpyWinCondition = async () => {
    // Get active (non-eliminated) players
    const activePlayers = Object.keys(game.players).filter(
      playerId => !eliminatedPlayers[playerId]
    );

    // If only 2 players left and one is spy, spy wins
    if (activePlayers.length === 2 && activePlayers.includes(game.currentRound.spy)) {
      const gameRef = ref(database, `games/${gameId}`);
      await update(gameRef, {
        status: 'ended',
        winner: 'spy',
        message: 'Spy wins! Only two players remain.'
      });
      return true;
    }
    return false;
  };

  // Modify handleVotingComplete to properly check remaining players
  const handleVotingComplete = async (votesData) => {
    if (!game?.currentRound?.spy) return;

    // Only count votes from active players
    const activeVotes = Object.entries(votesData).filter(
      ([voterId]) => !eliminatedPlayers[voterId]
    );

    const voteCounts = activeVotes.reduce((acc, [_, vote]) => {
      acc[vote.votedFor] = (acc[vote.votedFor] || 0) + 1;
      return acc;
    }, {});

    const mostVotedPlayer = Object.entries(voteCounts)
      .sort(([_, a], [__, b]) => b - a)[0]?.[0];

    const isSpy = game.currentRound.spy === mostVotedPlayer;
    
    const gameRef = ref(database, `games/${gameId}`);
    if (isSpy) {
      // Spy was caught - end game
      await update(gameRef, {
        status: 'ended',
        winner: 'players',
        votingResult: {
          votedPlayer: mostVotedPlayer,
          isSpy,
          votes: votesData
        },
        eliminatedPlayers: {
          ...game.eliminatedPlayers,
          [mostVotedPlayer]: true
        }
      });
    } else {
      // Player was eliminated - check remaining players
      const updatedEliminatedPlayers = {
        ...game.eliminatedPlayers,
        [mostVotedPlayer]: true
      };
      
      // Update eliminated players first
      await update(gameRef, {
        eliminatedPlayers: updatedEliminatedPlayers,
        votingResult: {
          votedPlayer: mostVotedPlayer,
          isSpy,
          votes: votesData
        }
      });

      // Check if only 2 players remain and one is the spy
      const remainingPlayers = Object.keys(game.players).filter(
        playerId => !updatedEliminatedPlayers[playerId]
      );

      if (remainingPlayers.length === 2 && remainingPlayers.includes(game.currentRound.spy)) {
        await update(gameRef, {
          status: 'ended',
          winner: 'spy',
          message: 'Spy wins! Only two players remain.'
        });
      } else {
        // Continue game with new round
        await startNewRound();
      }
    }

    setVotingPhase('result');
    setVotingResult({
      votedPlayer: mostVotedPlayer,
      isSpy,
      votes: votesData
    });
    setShowVotingPopup(false);
  };

  // Add function to start a new round
  const startNewRound = async () => {
    const isSpyWin = await checkSpyWinCondition();
    if (isSpyWin) return;

    const playerIds = Object.keys(game.players).filter(
      playerId => !eliminatedPlayers[playerId]
    );
    
    const gameRef = ref(database, `games/${gameId}`);
    const timeLimit = game.currentRound.timeLimit; // Keep same time limit as previous round
    
    await update(gameRef, {
      status: "playing",
      currentRound: {
        spy: game.currentRound.spy, // Keep same spy
        location: game.currentRound.location, // Keep same location
        category: game.currentRound.category, // Keep same category
        startedAt: Date.now(), // Reset start time
        timeLimit: timeLimit,
      },
      votes: null, // Clear previous votes
    });
    
    setVotes({});
    setVotingResult(null);
    setVotingPhase('none');
    setShowVotingPopup(false);
    setVoteCallRequests({});
    setShowVoteCallButton(true);
  };

  // Add function to handle vote call requests
  const requestVoteCall = async () => {
    if (!gameId || !currentUser) return;
    
    const voteCallRef = ref(database, `games/${gameId}/voteCallRequests/${currentUser.uid}`);
    await update(voteCallRef, {
      requested: true,
      timestamp: Date.now(),
      playerName: currentUser.displayName || currentUser.email
    });
  };

  // Add effect to listen for vote call requests
  useEffect(() => {
    if (!gameId || !game?.players) return;

    const voteCallRef = ref(database, `games/${gameId}/voteCallRequests`);
    const unsubscribe = onValue(voteCallRef, (snapshot) => {
      const requests = snapshot.val() || {};
      setVoteCallRequests(requests);

      // Check if majority wants to vote
      const activePlayers = Object.keys(game.players).filter(
        playerId => !eliminatedPlayers[playerId]
      );
      const activePlayerCount = activePlayers.length;
      const activeRequests = Object.keys(requests).filter(
        playerId => !eliminatedPlayers[playerId]
      ).length;

      if (activeRequests > activePlayerCount / 2) {
        setVotingPhase('voting');
        setShowVotingPopup(true);
        // Clear vote call requests
        const gameRef = ref(database, `games/${gameId}`);
        update(gameRef, {
          voteCallRequests: {}
        });
      }
    });

    return () => unsubscribe();
  }, [gameId, game?.players, eliminatedPlayers]);

  // Add effect to listen for eliminated players
  useEffect(() => {
    if (!gameId) return;

    const eliminatedRef = ref(database, `games/${gameId}/eliminatedPlayers`);
    const unsubscribe = onValue(eliminatedRef, (snapshot) => {
      setEliminatedPlayers(snapshot.val() || {});
    });

    return () => unsubscribe();
  }, [gameId]);

  // Handle redirection for all players
  useEffect(() => {
    if (!gameId || !game?.redirectTo || !currentUser) return;

    // Reset all states immediately
    setShowEndGamePopup(false);
    setVotingPhase('none');
    setVotingResult(null);
    setPlayAgainPlayers({});
    
    // Navigate to new game
    navigate(`/game/${game.redirectTo}`);
  }, [gameId, game?.redirectTo, currentUser, navigate]);

  // Add effect to show popup when game ends
  useEffect(() => {
    if (game?.status === 'ended' && votingPhase === 'result') {
      setShowEndGamePopup(true);
    } else if (game?.status === 'waiting' || game?.status === 'redirecting') {
      setShowEndGamePopup(false);
    }
  }, [game?.status, votingPhase]);

  // Clean up function
  useEffect(() => {
    return () => {
      if (gameId && game?.redirectTo) {
        const oldGameRef = ref(database, `games/${gameId}`);
        update(oldGameRef, {
          redirectTo: null,
          playAgainRequests: {},
          status: 'ended'
        }).catch(console.error);
      }
    };
  }, [gameId, game?.redirectTo]);

  // Add debug logging for current game state
  useEffect(() => {
    if (game?.players) {
      console.log('Current game players:', game.players);
    }
  }, [game?.players]);

  const startGame = async () => {
    if (!game || !isHost || !selectedCategory) return;

    const playerIds = Object.keys(game.players);
    const randomSpy = playerIds[Math.floor(Math.random() * playerIds.length)];
    const categoryLocations = categories[selectedCategory];
    const randomLocation =
      categoryLocations[Math.floor(Math.random() * categoryLocations.length)];

    const gameRef = ref(database, `games/${gameId}`);
    const timeLimit = selectedTime === 'unlimited' ? null : parseInt(selectedTime) * 60;
    
    try {
      await update(gameRef, {
        status: "playing",
        currentRound: {
          spy: randomSpy,
          location: randomLocation,
          category: selectedCategory,
          startedAt: Date.now(),
          timeLimit: timeLimit,
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

  // Modify the effect to auto-dismiss voting result for eliminated players
  useEffect(() => {
    if (eliminatedPlayers[currentUser?.uid] && votingPhase === 'result' && game?.status !== 'ended') {
      const timer = setTimeout(() => {
        setVotingPhase('none');
        setVotingResult(null);
      }, 3000); // Auto dismiss after 3 seconds for eliminated players

      return () => clearTimeout(timer);
    }
  }, [votingPhase, eliminatedPlayers, currentUser?.uid, game?.status]);

  // Add effect to reset voting phase when redirected to new game
  useEffect(() => {
    if (game?.redirectTo) {
      setVotingPhase('none');
      setVotingResult(null);
    }
  }, [game?.redirectTo]);

  // Add effect to reset voting phase when joining new game
  useEffect(() => {
    if (game?.status === 'waiting') {
      setVotingPhase('none');
      setVotingResult(null);
    }
  }, [game?.status]);

  // Add cleanup effect when component unmounts
  useEffect(() => {
    return () => {
      setVotingPhase('none');
      setVotingResult(null);
      setPlayAgainPlayers({});
    };
  }, []);

  // Add effect to reset state when game changes
  useEffect(() => {
    if (game?.status === 'waiting') {
      setVotingPhase('none');
      setVotingResult(null);
      setPlayAgainPlayers({});
    }
  }, [game?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Game not found</div>
      </div>
    );
  }

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
                    {gameStarted && game?.currentRound?.timeLimit && (
                      <div className="text-xl font-bold mb-4">
                        Time Remaining: {Math.floor(timeLeft / 60)}:
                        {String(timeLeft % 60).padStart(2, '0')}
                      </div>
                    )}
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
                        className={`flex items-center space-x-3 p-4 ${
                          eliminatedPlayers[playerId]
                            ? 'bg-gray-200 opacity-50'
                            : 'bg-gray-50'
                        } rounded-lg`}
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
                          <div className="font-medium">
                            {player.name}
                            {eliminatedPlayers[playerId] && ' (Eliminated)'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {player.isHost ? "Host" : "Player"}
                          </div>
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
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">
                              Select Category:
                            </label>
                            <select
                              value={selectedCategory || ""}
                              onChange={(e) => setSelectedCategory(e.target.value)}
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

                          <div>
                            <label className="block text-sm font-medium text-gray-700">
                              Round Time:
                            </label>
                            <select
                              value={selectedTime}
                              onChange={(e) => setSelectedTime(e.target.value)}
                              className="w-full p-2 border rounded-md"
                            >
                              <option value="1">1 minute</option>
                              <option value="2">2 minutes</option>
                              <option value="3">3 minutes</option>
                              <option value="5">5 minutes</option>
                              <option value="10">10 minutes</option>
                              <option value="15">15 minutes</option>
                              <option value="unlimited">No Time Limit</option>
                            </select>
                          </div>
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

            {/* Text Chat - Replace the old chat implementation with GameChat component */}
            <div className="bg-white rounded-lg shadow-md h-[400px]">
              <GameChat 
                gameId={gameId} 
                currentUser={currentUser} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Vote Call Button */}
      {gameStarted && showVoteCallButton && !showVotingPopup && !eliminatedPlayers[currentUser.uid] && (
        <div className="fixed bottom-4 right-4">
          <div className="bg-white rounded-lg shadow-lg p-4">
            <button
              onClick={requestVoteCall}
              disabled={voteCallRequests[currentUser?.uid]}
              className={`px-4 py-2 rounded-lg ${
                voteCallRequests[currentUser?.uid]
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {voteCallRequests[currentUser?.uid] ? 'Vote Requested' : 'Request Vote'}
            </button>
            <div className="text-sm text-gray-600 mt-2">
              <div>
                Vote Requests: {
                  Object.keys(voteCallRequests).filter(
                    playerId => !eliminatedPlayers[playerId]
                  ).length
                } / {
                  Object.keys(game.players).filter(
                    playerId => !eliminatedPlayers[playerId]
                  ).length
                } active players
              </div>
              <div className="mt-1 text-xs">
                {Object.entries(voteCallRequests)
                  .filter(([playerId]) => !eliminatedPlayers[playerId])
                  .map(([_, request]) => (
                    <div key={request.timestamp}>{request.playerName} requested</div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voting Popup */}
      {votingPhase === 'voting' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">Vote for the Spy</h2>
            <div className="space-y-3">
              {Object.entries(game.players || {}).map(([playerId, player]) => (
                <button
                  key={playerId}
                  onClick={() => castVote(playerId)}
                  disabled={
                    votes[currentUser.uid] || // Already voted
                    playerId === currentUser.uid || // Can't vote for self
                    eliminatedPlayers[playerId] || // Can't vote for eliminated players
                    eliminatedPlayers[currentUser.uid] // Can't vote if eliminated
                  }
                  className={`w-full p-3 text-left rounded-lg transition ${
                    eliminatedPlayers[playerId]
                      ? 'bg-gray-200 opacity-50 cursor-not-allowed'
                      : playerId === currentUser.uid 
                      ? 'bg-gray-100 cursor-not-allowed opacity-50'
                      : votes[currentUser.uid]?.votedFor === playerId
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Avatar
                      user={{
                        displayName: player.name,
                        photoURL: player.photoURL,
                      }}
                      size="sm"
                    />
                    <span>
                      {player.name}
                      {eliminatedPlayers[playerId] && ' (Eliminated)'}
                    </span>
                    {playerId === currentUser.uid && (
                      <span className="text-sm text-gray-500">(You)</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            
            {/* Show current votes */}
            <div className="mt-4 pt-4 border-t">
              <h3 className="font-semibold mb-2">Votes cast:</h3>
              {Object.entries(votes).map(([voterId, vote]) => (
                <div key={voterId} className="text-sm text-gray-600">
                  {vote.voterName} voted for {game.players[vote.votedFor]?.name}
                </div>
              ))}
              {eliminatedPlayers[currentUser.uid] && (
                <p className="mt-2 text-sm text-gray-500 italic">
                  You are eliminated and cannot vote
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Voting Result Popup */}
      {game?.status === 'ended' && votingPhase === 'result' && !game?.redirectTo && game?.status !== 'redirecting' && (
        <EndGamePopup
          game={game}
          currentUser={currentUser}
          votingResult={votingResult}
          playAgainPlayers={playAgainPlayers}
          onPlayAgain={handlePlayAgain}
          onReturn={() => navigate('/')}
        />
      )}
    </div>
  );
}