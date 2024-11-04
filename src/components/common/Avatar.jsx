export default function Avatar({ user, size = 'md' }) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-md',
    lg: 'w-12 h-12 text-lg'
  };

  // Updated getInitials function with better fallback
  const getInitials = () => {
    if (user.displayName) {
      return user.displayName
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.name) {
      return user.name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return '?'; // Fallback if no name or email is available
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-blue-500 text-white flex items-center justify-center font-medium`}
    >
      {user.photoURL ? (
        <img
          src={user.photoURL}
          alt={user.displayName || user.name || user.email || 'User'}
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        <span>{getInitials()}</span>
      )}
    </div>
  );
}