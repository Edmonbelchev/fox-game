import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import GameLobby from './components/game/GameLobby';
import GameRoom from './components/game/GameRoom';

export default function AppRoutes() {
  const { currentUser } = useAuth();

  // Protected Route wrapper
  const PrivateRoute = ({ children }) => {
    if (!currentUser) {
      return <Navigate to="/login" />;
    }
    return children;
  };

  return (
    <Routes>
      {/* Auth Routes */}
      <Route 
        path="/login" 
        element={currentUser ? <Navigate to="/" /> : <Login />} 
      />
      <Route 
        path="/register" 
        element={currentUser ? <Navigate to="/" /> : <Register />} 
      />

      {/* Game Routes */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <GameLobby />
          </PrivateRoute>
        }
      />

      {/* Important: This route needs to be before the catch-all route */}
      <Route
        path="/game/:gameId"
        element={
          <PrivateRoute>
            <GameRoom />
          </PrivateRoute>
        }
      />

      {/* Make sure this is the last route */}
      <Route 
        path="*" 
        element={<Navigate to="/" />} 
      />
    </Routes>
  );
}