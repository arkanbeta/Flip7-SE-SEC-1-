// Friendly text for room errors. `details.code` of ALREADY_IN_OTHER_ROOM is the code of the
// room the player is already in (the backend sends it so the UI can link to it).
const MESSAGES = {
  ROOM_NOT_FOUND: 'No room with that code exists. Check the code and try again.',
  ROOM_FULL: 'That room is full.',
  GAME_IN_PROGRESS: 'That game has already started.',
  INVALID_ROOM_CODE: 'That is not a valid room code.',
  ALREADY_IN_OTHER_ROOM: 'You are already in another room. Leave it first or go back to it.',
  ROOM_CODE_UNAVAILABLE: 'Could not make a room code right now. Please try again.',
  NOT_YOUR_TURN: 'It is not your turn.',
  STALE_MOVE: 'That move came too late.',
  INVALID_MOVE: 'That move is not allowed.',
  GAME_NOT_RUNNING: 'There is no game running.',
  MATCH_NOT_OVER: 'The match is not over yet.',
  NOT_ENOUGH_PLAYERS: 'At least 3 players must be ready to start.',
  NOT_CREATOR: 'Only the host can do that.',
  BANNED: 'The host banned you from that room.',
  PLAYER_NOT_IN_ROOM: 'That player is no longer in the room.',
  KICK_NEEDS_MORE_PLAYERS: 'A match needs at least 3 players, so nobody can be kicked right now.',
  LEAVE_CONFIRMATION_REQUIRED: 'Please confirm that you want to leave.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'Cannot reach the server. Check your connection.',
};
export const roomErrorMessage = (error) => MESSAGES[error?.code] ?? error?.message ?? 'Something went wrong.';
