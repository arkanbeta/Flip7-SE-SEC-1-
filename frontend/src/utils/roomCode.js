// Client-side convenience for the room-code box. The backend (Phase 4) is the only one
// that really decides whether a code exists; this just gives instant feedback on typos.
// GameRooms.room_code is VARCHAR(10), so 4-10 letters/digits is accepted for now.
export const ROOM_CODE_RULE = 'Room codes are 4-10 letters or numbers.';

// Forgiving on input: a pasted room link (".../rooms/3V7UJ9") keeps only the code after it.
export const normalizeRoomCode = (value) =>
  value.replace(/^.*\/rooms\//i, '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 10);
export const isValidRoomCode = (value) => /^[A-Z0-9]{4,10}$/.test(value);
