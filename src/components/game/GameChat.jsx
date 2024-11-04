import { useState, useEffect, useRef } from 'react';
import { database } from '../../firebase/config';
import { ref, push, onValue, set } from 'firebase/database';
import Avatar from '../common/Avatar';

export default function GameChat({ gameId, currentUser, isSpectator = false }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const messagesEndRef = useRef(null);
  const [error, setError] = useState(null);

  // Voice chat state
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Listen for chat messages
    const messagesRef = ref(database, `games/${gameId}/messages`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const messagesList = Object.values(data);
        setMessages(messagesList);
        scrollToBottom();
      }
    });

    return () => {
      unsubscribe();
      // Clean up voice chat
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [gameId, stream]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      const messagesRef = ref(database, `games/${gameId}/messages`);
      await push(messagesRef, {
        text: newMessage,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        userPhoto: currentUser.photoURL,
        timestamp: Date.now(),
        isSpectator
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message');
    }
  };

  // Voice chat functions
  const startVoiceChat = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(mediaStream);
      setIsVoiceConnected(true);
      
      // Here you would typically connect to a WebRTC service
      // For now, we'll just show that the microphone is active
      console.log('Voice chat started');
    } catch (error) {
      console.error('Error starting voice chat:', error);
      setError('Failed to start voice chat');
    }
  };

  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const stopVoiceChat = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsVoiceConnected(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Voice Chat Controls */}
      <div className="bg-gray-100 p-4 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-700">Voice Channel</h3>
          <div className="flex space-x-2">
            {!isVoiceConnected ? (
              <button
                onClick={startVoiceChat}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition"
              >
                Join Voice
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  className={`px-4 py-2 ${isMuted ? 'bg-yellow-500' : 'bg-blue-500'} text-white rounded hover:opacity-90 transition`}
                >
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={stopVoiceChat}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition"
                >
                  Leave Voice
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex items-start space-x-3 ${
              message.userId === currentUser.uid ? 'justify-end' : ''
            }`}
          >
            {message.userId !== currentUser.uid && (
              <Avatar
                user={{
                  displayName: message.userName,
                  photoURL: message.userPhoto
                }}
                size="sm"
              />
            )}
            <div
              className={`flex flex-col ${
                message.userId === currentUser.uid ? 'items-end' : 'items-start'
              }`}
            >
              <span className="text-xs text-gray-500">{message.userName}</span>
              <div
                className={`px-4 py-2 rounded-lg ${
                  message.userId === currentUser.uid
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {message.text}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <form onSubmit={sendMessage} className="p-4 bg-gray-100 rounded-b-lg">
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

      {/* Error Display */}
      {error && (
        <div className="p-2 text-red-500 text-sm text-center">
          {error}
        </div>
      )}
    </div>
  );
}