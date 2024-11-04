import { useState, useEffect, useRef } from 'react';
import { database } from '../../firebase/config';
import { ref, push, onValue } from 'firebase/database';
import Avatar from '../common/Avatar';
import EmojiPicker from 'emoji-picker-react';
import { formatDistanceToNow } from 'date-fns';

export default function GameChat({ gameId, currentUser, isSpectator = false }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const scrollToBottom = () => {
    // Only auto-scroll if user is near bottom
    const container = chatContainerRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  useEffect(() => {
    const messagesRef = ref(database, `games/${gameId}/messages`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const messagesList = Object.entries(data).map(([id, message]) => ({
          id,
          ...message,
        }));
        setMessages(messagesList);
        scrollToBottom();
      }
    });

    return () => unsubscribe();
  }, [gameId]);

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
      setShowEmojiPicker(false);
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message');
    }
  };

  const onEmojiClick = (emojiData) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const groupMessagesByDate = (messages) => {
    const groups = {};
    messages.forEach(message => {
      const date = new Date(message.timestamp).toLocaleDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
    });
    return groups;
  };

  const messageGroups = groupMessagesByDate(messages);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Chat Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Game Chat</h3>
      </div>

      {/* Messages Container */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-6"
      >
        {Object.entries(messageGroups).map(([date, groupMessages]) => (
          <div key={date} className="space-y-4">
            <div className="flex items-center">
              <div className="flex-1 border-t border-gray-200"></div>
              <span className="px-3 text-xs text-gray-500 bg-gray-50">{date}</span>
              <div className="flex-1 border-t border-gray-200"></div>
            </div>

            {groupMessages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start space-x-2 ${
                  message.userId === currentUser.uid ? 'justify-end' : 'justify-start'
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
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500">{message.userName}</span>
                    <span className="text-xs text-gray-400">
                      {formatDistanceToNow(message.timestamp, { addSuffix: true })}
                    </span>
                  </div>
                  <div
                    className={`px-4 py-2 rounded-2xl max-w-md break-words ${
                      message.userId === currentUser.uid
                        ? 'bg-blue-500 text-white rounded-tr-none'
                        : 'bg-white border border-gray-200 rounded-tl-none'
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <div className="p-4 bg-white border-t border-gray-200">
        <form onSubmit={sendMessage} className="relative">
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-2 text-gray-500 hover:text-gray-700 transition"
            >
              😊
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className={`px-4 py-2 rounded-full transition ${
                newMessage.trim()
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Send
            </button>
          </div>
          {showEmojiPicker && (
            <div className="absolute bottom-full right-0 mb-2">
              <EmojiPicker onEmojiClick={onEmojiClick} />
            </div>
          )}
        </form>
      </div>

      {error && (
        <div className="p-2 text-sm text-red-500 bg-red-50 text-center">
          {error}
        </div>
      )}
    </div>
  );
}