import crypto from 'node:crypto';

// Room codes are 6 characters, easy to read out loud: no 0/O, 1/I/L (they look alike).
// 31 symbols ^ 6 = ~887 million codes. crypto.randomInt is a secure random source, so codes
// cannot be predicted from earlier ones. Uniqueness is NOT decided here: the UNIQUE
// constraint on GameRooms.room_code is the real guarantee (see roomService).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}
