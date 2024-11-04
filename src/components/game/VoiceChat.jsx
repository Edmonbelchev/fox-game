import { useState, useEffect, useRef } from "react";
import { database } from "../../firebase/config";
import { ref, onValue, set, remove, onDisconnect } from "firebase/database";

export default function VoiceChat({ gameId, currentUser }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // new
  const [connectionError, setConnectionError] = useState(null); // new
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const audioContextRef = useRef(null);

  useEffect(() => {
    const participantsRef = ref(database, `games/${gameId}/voice/participants`);
    const speakingRef = ref(database, `games/${gameId}/voice/speaking`);

    const participantsUnsubscribe = onValue(participantsRef, (snapshot) => {
      const participantsData = snapshot.val() || {};
      const participantsList = Object.values(participantsData);
      setParticipants(participantsList);

      // Set up connections with new participants
      Object.keys(participantsData).forEach((peerId) => {
        if (peerId !== currentUser.uid && !peerConnectionsRef.current[peerId]) {
          createPeerConnection(peerId);
        }
      });
    });

    const speakingUnsubscribe = onValue(speakingRef, (snapshot) => {
      const speakingData = snapshot.val() || {};
      setSpeakingUsers(new Set(Object.keys(speakingData)));
    });

    return () => {
      participantsUnsubscribe();
      speakingUnsubscribe();
      leaveVoiceChat();
    };
  }, [gameId, currentUser.uid]);

  useEffect(() => {
    if (!isConnected) return;

    const candidatesRef = ref(
      database,
      `games/${gameId}/voice/candidates/${currentUser.uid}`
    );
    const unsubscribe = onValue(candidatesRef, async (snapshot) => {
      const candidatesData = snapshot.val();
      if (!candidatesData) return;

      Object.entries(candidatesData).forEach(([peerId, candidate]) => {
        const pc = peerConnectionsRef.current[peerId];
        if (pc && candidate) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
            console.error("Error adding ICE candidate:", error);
            setConnectionError("Failed to establish peer connection");
          });
        }
      });
    });

    return () => unsubscribe();
  }, [gameId, currentUser.uid, isConnected]);

  const createPeerConnection = (peerId) => {
    console.log("Creating peer connection for:", peerId);

    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302",
          ],
        },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
      iceCandidatePoolSize: 10,
    });

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection State for ${peerId}:`, pc.iceConnectionState);
      updateConnectionStatus(pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection State for ${peerId}:`, pc.connectionState);
      if (pc.connectionState === "failed") {
        setConnectionError("Connection failed. Please try rejoining.");
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`ICE Gathering State for ${peerId}:`, pc.iceGatheringState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("New ICE candidate:", event.candidate);
        const candidateRef = ref(
          database,
          `games/${gameId}/voice/candidates/${currentUser.uid}/${peerId}`
        );
        set(candidateRef, event.candidate);
      }
    };
    // Handle incoming stream
    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track);
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;

      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(event.streams[0]);
      const analyser = audioContext.createAnalyser();
      const gainNode = audioContext.createGain();

      source.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioContext.destination);

      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkAudioLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;

        const speakingRef = ref(
          database,
          `games/${gameId}/voice/speaking/${peerId}`
        );
        if (average > 25) {
          set(speakingRef, true);
        } else {
          remove(speakingRef);
        }

        requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();
      remoteAudio.play().catch(console.error);
    };

    // Handle negotiation
    pc.onnegotiationneeded = async () => {
      try {
        setConnectionStatus("connecting");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const offerRef = ref(
          database,
          `games/${gameId}/voice/offers/${currentUser.uid}/${peerId}`
        );
        await set(offerRef, { sdp: offer.sdp, type: offer.type });
      } catch (error) {
        console.error("Error creating offer:", error);
        setConnectionError("Failed to create connection offer");
      }
    };

    // Listen for remote offers
    const offerRef = ref(
      database,
      `games/${gameId}/voice/offers/${peerId}/${currentUser.uid}`
    );
    onValue(offerRef, async (snapshot) => {
      const offer = snapshot.val();
      if (offer && !pc.remoteDescription) {
        try {
          setConnectionStatus("connecting");
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          const answerRef = ref(
            database,
            `games/${gameId}/voice/answers/${currentUser.uid}/${peerId}`
          );
          await set(answerRef, { sdp: answer.sdp, type: answer.type });
        } catch (error) {
          console.error("Error handling offer:", error);
          setConnectionError("Failed to handle connection offer");
        }
      }
    });

    peerConnectionsRef.current[peerId] = pc;
    return pc;
  };

  const updateConnectionStatus = (state) => {
    switch (state) {
      case "checking":
        setConnectionStatus("connecting");
        break;
      case "connected":
      case "completed":
        setConnectionStatus("connected");
        setConnectionError(null);
        break;
      case "disconnected":
        setConnectionStatus("reconnecting");
        break;
      case "failed":
        setConnectionStatus("failed");
        setConnectionError("Connection failed. Please try rejoining.");
        break;
      default:
        setConnectionStatus("disconnected");
    }
  };

  const joinVoiceChat = async () => {
    try {
      setConnectionStatus("connecting");
      console.log("Requesting audio stream...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log("Audio stream obtained:", stream);

      localStreamRef.current = stream;

      // Set up local audio analysis
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      source.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkAudioLevel = () => {
        if (!isConnected) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;

        const speakingRef = ref(
          database,
          `games/${gameId}/voice/speaking/${currentUser.uid}`
        );
        if (average > 25) {
          set(speakingRef, true);
        } else {
          remove(speakingRef);
        }

        requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();

      // Add participant to Firebase
      const participantRef = ref(
        database,
        `games/${gameId}/voice/participants/${currentUser.uid}`
      );
      await set(participantRef, {
        id: currentUser.uid,
        name: currentUser.displayName || currentUser.email,
        joinedAt: Date.now(),
      });

      onDisconnect(participantRef).remove();

      participants.forEach((participant) => {
        if (participant.id !== currentUser.uid) {
          createPeerConnection(participant.id);
        }
      });

      setIsConnected(true);
      console.log("Successfully joined voice chat");
    } catch (error) {
      console.error("Error joining voice chat:", error);
      setConnectionError("Failed to access microphone");
      setConnectionStatus("failed");
    }
  };

  const leaveVoiceChat = async () => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};

      const participantRef = ref(
        database,
        `games/${gameId}/voice/participants/${currentUser.uid}`
      );
      await remove(participantRef);

      const speakingRef = ref(
        database,
        `games/${gameId}/voice/speaking/${currentUser.uid}`
      );
      await remove(speakingRef);

      setIsConnected(false);
      setConnectionStatus("disconnected");
      setConnectionError(null);
    } catch (error) {
      console.error("Error leaving voice chat:", error);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "bg-green-500";
      case "connecting":
        return "bg-yellow-500";
      case "reconnecting":
        return "bg-yellow-500 animate-pulse";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden w-full">
      {/* Header - Simplified layout */}
      <div className="p-3 bg-gray-50 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-900">Voice Chat</h3>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded-full">
              <div className={`w-1.5 h-1.5 rounded-full ${getConnectionStatusColor()}`} />
              <span className="text-xs text-gray-600 capitalize">{connectionStatus}</span>
            </div>
          </div>

          {/* Buttons - More compact */}
          <div className="flex gap-2">
            {!isConnected ? (
              <button
                onClick={joinVoiceChat}
                disabled={connectionStatus === "connecting"}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-xs font-medium 
                         rounded hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {connectionStatus === "connecting" ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span>Join Voice</span>
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors
                            ${isMuted ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-500 hover:bg-blue-600'} 
                            text-white`}
                >
                  {isMuted ? (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                  <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button
                  onClick={leaveVoiceChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white text-xs font-medium 
                           rounded hover:bg-red-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Leave</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error Message - More subtle */}
      {connectionError && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-1.5 text-red-600">
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs">{connectionError}</span>
          </div>
        </div>
      )}

      {/* Participants - Cleaner grid */}
      {isConnected && (
        <div className="p-3">
          <h4 className="text-xs font-medium text-gray-500 mb-2">
            Participants ({participants.length})
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {participants.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    speakingUsers.has(participant.id)
                      ? "bg-green-500 animate-pulse"
                      : participant.id === currentUser.uid
                      ? "bg-blue-500"
                      : "bg-gray-400"
                  }`}
                />
                <span className="text-xs font-medium text-gray-700 truncate">
                  {participant.name}
                </span>
                {speakingUsers.has(participant.id) && (
                  <div className="flex gap-0.5 ml-auto">
                    <div className="w-0.5 h-2 bg-green-500 rounded-full animate-[soundWave_0.5s_ease-in-out_infinite]" />
                    <div className="w-0.5 h-2 bg-green-500 rounded-full animate-[soundWave_0.5s_ease-in-out_infinite_0.1s]" />
                    <div className="w-0.5 h-2 bg-green-500 rounded-full animate-[soundWave_0.5s_ease-in-out_infinite_0.2s]" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
