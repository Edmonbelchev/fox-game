import { useState, useEffect, useRef } from "react";
import { database } from "../../firebase/config";
import { ref, onValue, set, remove, onDisconnect, update } from "firebase/database";
import Avatar from '../common/Avatar';

// Add this function to check if peers are on the same network
const areOnSameNetwork = async (peerId) => {
  try {
    // Get local IP addresses
    const rtc = new RTCPeerConnection();
    await rtc.createDataChannel('');
    await rtc.createOffer().then(o => rtc.setLocalDescription(o));
    
    return new Promise((resolve) => {
      rtc.onicecandidate = (event) => {
        if (!event.candidate) {
          rtc.close();
          resolve(false); // Default to false if we can't determine
          return;
        }
        
        const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/;
        const match = ipRegex.exec(event.candidate.candidate);
        if (match) {
          const ip = match[1];
          rtc.close();
          resolve(ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.'));
        }
      };
    });
  } catch (error) {
    console.error('Error checking network:', error);
    return false;
  }
};

export default function VoiceChat({ gameId, currentUser }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [connectionError, setConnectionError] = useState(null);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  
  const localStreamRef = useRef(null);
  const videoRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const remoteVideosRef = useRef({});

  // Add these state variables
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);

  // Move updateConnectionStatus inside the component
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

  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        
        // Set default device if none selected
        if (!selectedAudioDevice && audioInputs.length > 0) {
          setSelectedAudioDevice(audioInputs[0].deviceId);
        }
      } catch (error) {
        console.error('Error getting audio devices:', error);
      }
    };

    getAudioDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, [selectedAudioDevice]);

  const createPeerConnection = (peerId) => {
    console.log("Creating peer connection for:", peerId);

    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302"
          ]
        },
        {
          urls: [
            'turn:relay1.expressturn.com:3478',
            'turn:relay2.expressturn.com:3478'
          ],
          username: 'efK7QHFPZK9BN3ER8P',
          credential: 'JWU7ZBQKQ42AMLWVPY'
        }
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan',
      iceCandidatePoolSize: 10
    });

    // Monitor ICE connection state
    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
      updateConnectionStatus(pc.iceConnectionState);
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === 'connected') {
        setConnectionStatus("connected");
        setConnectionError(null);
      }
    };

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind, "from peer:", peerId);
      const stream = event.streams[0];
      
      if (stream) {
        // Handle audio track
        if (event.track.kind === 'audio') {
          const audioElement = new Audio();
          audioElement.srcObject = stream;  // Use the whole stream instead of just the track
          audioElement.autoplay = true;
          audioElement.volume = 1.0;
          
          audioElement.play().catch(error => {
            console.error("Error playing audio:", error);
          });
        }

        setRemoteStreams(prev => ({
          ...prev,
          [peerId]: stream
        }));
      }
    };

    // Add existing local stream if available
    if (localStreamRef.current) {
      console.log("Adding existing stream to new peer connection");
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    return pc;
  };

  const joinVoiceChat = async () => {
    try {
      setConnectionStatus("connecting");
      console.log("Requesting media stream...");
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: true
      });
      
      console.log("Media stream obtained:", stream);
      console.log("Audio tracks:", stream.getAudioTracks());

      localStreamRef.current = stream;

      // Disable video track initially
      stream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });

      // Set up video element
      if (videoRef.current) {
        console.log("Setting video source...");
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
          console.log("Video playback started");
        } catch (err) {
          console.error("Error playing video:", err);
        }
      }

      // Add stream to peer connections
      Object.values(peerConnectionsRef.current).forEach(pc => {
        console.log("Adding stream to peer connection");
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
      });

      // Set up local audio analysis WITHOUT connecting to destination
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      
      source.connect(analyser);
      // DO NOT connect to audioContext.destination

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
        videoEnabled: isVideoOn,
        audioEnabled: !isMuted
      });

      onDisconnect(participantRef).remove();

      setIsConnected(true);
      setConnectionStatus("connected");
      console.log("Successfully joined voice chat");
    } catch (error) {
      console.error("Error joining voice chat:", error);
      setConnectionError(`Failed to access media devices: ${error.message}`);
      setConnectionStatus("failed");
    }
  };

  const leaveVoiceChat = async () => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      
      // Clean up remote videos
      Object.values(remoteVideosRef.current).forEach(video => {
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
          video.srcObject = null;
        }
      });
      remoteVideosRef.current = {};
      setRemoteStreams({});
      
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
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        
        // Update participant state in Firebase
        const participantRef = ref(
          database,
          `games/${gameId}/voice/participants/${currentUser.uid}`
        );
        update(participantRef, {
          audioEnabled: audioTrack.enabled
        });
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(!isVideoOn);
        
        // Update participant state in Firebase
        const participantRef = ref(
          database,
          `games/${gameId}/voice/participants/${currentUser.uid}`
        );
        update(participantRef, {
          videoEnabled: !isVideoOn
        });
      }
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

  // Add retry logic for failed connections
  let retryCount = 0;
  const MAX_RETRIES = 3;

  const handleConnectionFailure = async (pc, peerId) => {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying connection (${retryCount + 1}/${MAX_RETRIES})...`);
      retryCount++;
      
      // Close existing connection
      pc.close();
      
      // Create new connection
      const newPc = await createPeerConnection(peerId);
      peerConnectionsRef.current[peerId] = newPc;
      
      // Restart signaling process
      // ... your signaling code ...
    } else {
      console.error('Max retries reached, connection failed');
      setConnectionError('Connection failed after multiple attempts');
    }
  };

  // Add function to switch audio device
  const switchAudioDevice = async (deviceId) => {
    try {
      setSelectedAudioDevice(deviceId);
      
      if (isConnected && localStreamRef.current) {
        // Stop current tracks
        localStreamRef.current.getAudioTracks().forEach(track => track.stop());
        
        // Get new stream with selected device
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
          }
        });

        // Replace track in all peer connections
        const newTrack = newStream.getAudioTracks()[0];
        Object.values(peerConnectionsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) {
            sender.replaceTrack(newTrack);
          }
        });

        // Update local stream
        localStreamRef.current.addTrack(newTrack);
      }
    } catch (error) {
      console.error('Error switching audio device:', error);
      setConnectionError('Failed to switch audio device');
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
                
                {/* Add Video Toggle Button */}
                <button
                  onClick={toggleVideo}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors
                            ${isVideoOn ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-500 hover:bg-gray-600'} 
                            text-white`}
                >
                  {isVideoOn ? (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636" />
                    </svg>
                  )}
                  <span>{isVideoOn ? 'Video On' : 'Video Off'}</span>
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

      {/* Add Video Grid when connected */}
      {isConnected && (
        <div className="p-3 bg-gray-900">
          <div className="grid grid-cols-2 gap-2">
            {participants.map((participant) => (
              <div
                key={participant.id}
                className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center"
              >
                {participant.id === currentUser.uid ? (
                  // Local user's video
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${!isVideoOn && 'hidden'}`}
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    {!isVideoOn && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Avatar
                          user={{
                            displayName: participant.name,
                            photoURL: participant.photoURL,
                          }}
                          size="lg"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  // Remote user's video
                  <>
                    {remoteStreams[participant.id] ? (
                      <video
                        key={participant.id}
                        ref={el => {
                          if (el) {
                            el.srcObject = remoteStreams[participant.id];
                            remoteVideosRef.current[participant.id] = el;
                          }
                        }}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <Avatar
                          user={{
                            displayName: participant.name,
                            photoURL: participant.photoURL,
                          }}
                          size="lg"
                        />
                      </div>
                    )}
                  </>
                )}
                
                {/* Audio/Video Status Indicators */}
                <div className="absolute bottom-2 left-2 flex space-x-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      speakingUsers.has(participant.id)
                        ? "bg-green-500 animate-pulse"
                        : "bg-gray-400"
                    }`}
                  />
                  {participant.id === currentUser.uid && isVideoOn && (
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                  )}
                </div>

                {/* Participant Name */}
                <div className="absolute bottom-2 right-2">
                  <span className="text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                    {participant.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls - Modify existing controls */}
      <div className="p-3 bg-gray-50 border-t">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {!isConnected ? (
              <button
                onClick={joinVoiceChat}
                disabled={connectionStatus === "connecting"}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-xs font-medium 
                         rounded hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {/* ... existing join button code ... */}
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors
                            ${isMuted ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-500 hover:bg-blue-600'} 
                            text-white`}
                >
                  {/* ... existing mute button code ... */}
                </button>
                
                {/* Add Video Toggle Button */}
                <button
                  onClick={toggleVideo}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors
                            ${isVideoOn ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-500 hover:bg-gray-600'} 
                            text-white`}
                >
                  {isVideoOn ? (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636" />
                    </svg>
                  )}
                  <span>{isVideoOn ? 'Video On' : 'Video Off'}</span>
                </button>

                <button
                  onClick={leaveVoiceChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded hover:bg-red-600 transition-colors">
                  {/* ... existing leave button code ... */}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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

      {/* Add this before or after your existing controls */}
      <div className="flex items-center gap-2">
        <select
          value={selectedAudioDevice || ''}
          onChange={(e) => switchAudioDevice(e.target.value)}
          disabled={!isConnected}
          className="px-2 py-1 text-xs rounded border border-gray-300 bg-white disabled:bg-gray-100
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {audioDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
            </option>
          ))}
        </select>
        
        {/* Microphone indicator */}
        {isConnected && (
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <svg 
              className="w-3.5 h-3.5" 
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" 
              />
            </svg>
            <span>
              {audioDevices.find(d => d.deviceId === selectedAudioDevice)?.label?.split('(')[0] || 'Default Microphone'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
