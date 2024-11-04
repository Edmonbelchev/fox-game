import { useState, useEffect } from 'react';
import { database } from '../../firebase/config';
import { ref, update } from 'firebase/database';

export default function GameTimer({ gameId, onTimeUp }) {
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes

  useEffect(() => {
    if (timeLeft <= 0) {
      onTimeUp();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(time => time - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, onTimeUp]);

  return (
    <div className="text-center">
      <div className="text-2xl font-bold">
        {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-1000"
          style={{ width: `${(timeLeft / 120) * 100}%` }}
        />
      </div>
    </div>
  );
}