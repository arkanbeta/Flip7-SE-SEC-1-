import { AppError } from '../utils/AppError.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../utils/roomRules.js';

const fail = (code, field, message) => new AppError(400, code, message, { field });

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw fail('VALIDATION_ERROR', 'body', 'Request body must be a JSON object.');
  }
}

// POST /api/rooms { gameModeId, maxPlayers }
export function validateCreateRoom(body) {
  requireObject(body);
  const { gameModeId, maxPlayers } = body;
  if (!Number.isInteger(gameModeId) || gameModeId < 1) {
    throw fail('VALIDATION_ERROR', 'gameModeId', 'Please choose a game mode.');
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    throw fail('VALIDATION_ERROR', 'maxPlayers', `Player limit must be a whole number from ${MIN_PLAYERS} to ${MAX_PLAYERS}.`);
  }
  return { gameModeId, maxPlayers };
}

// Cleans a room code typed by a person: trims, upper-cases, then checks the format.
export function validateRoomCode(value) {
  if (typeof value !== 'string') throw fail('INVALID_ROOM_CODE', 'code', 'Enter a room code.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) {
    throw fail('INVALID_ROOM_CODE', 'code', 'Room codes are 4-10 letters or numbers.');
  }
  return code;
}

export function validateJoinRoom(body) {
  requireObject(body);
  return { code: validateRoomCode(body.code) };
}

// POST /api/rooms/current/game/action
//   { type: 'hit' | 'stay' }  or  { type: 'target' | 'gift', targetId }   plus  decisionId
// decisionId says WHICH question is being answered, so a double click or a late request
// can never answer a newer question by accident.
export function validateGameAction(body) {
  requireObject(body);
  const { type, decisionId, targetId } = body;
  if (!['hit', 'stay', 'target', 'gift'].includes(type)) {
    throw fail('VALIDATION_ERROR', 'type', 'Unknown move.');
  }
  if (!Number.isInteger(decisionId) || decisionId < 1) {
    throw fail('VALIDATION_ERROR', 'decisionId', 'Missing question number.');
  }
  if (type === 'target' || type === 'gift') {
    if (!Number.isInteger(targetId) || targetId < 1) throw fail('VALIDATION_ERROR', 'targetId', 'Choose a player.');
    return { type, decisionId, targetId };
  }
  return { type, decisionId };
}

// POST /api/rooms/current/ready { ready: boolean }
export function validateReady(body) {
  requireObject(body);
  if (typeof body.ready !== 'boolean') throw fail('VALIDATION_ERROR', 'ready', 'ready must be true or false.');
  return { ready: body.ready };
}

// POST /api/rooms/current/remove { playerId, ban?: boolean }
export function validateRemovePlayer(body) {
  requireObject(body);
  if (!Number.isInteger(body.playerId) || body.playerId < 1) throw fail('VALIDATION_ERROR', 'playerId', 'Choose a player.');
  if (body.ban !== undefined && typeof body.ban !== 'boolean') throw fail('VALIDATION_ERROR', 'ban', 'ban must be true or false.');
  return { playerId: body.playerId, ban: body.ban === true };
}

// POST /api/rooms/current/leave { confirm?: true }
export function validateLeave(body) {
  if (body === undefined || body === null) return { confirm: false };
  requireObject(body);
  if (body.confirm !== undefined && typeof body.confirm !== 'boolean') {
    throw fail('VALIDATION_ERROR', 'confirm', 'confirm must be true or false.');
  }
  return { confirm: body.confirm === true };
}

// POST /api/rooms/current/start-response { answer: 'yes' | 'no' }
export function validateStartAnswer(body) {
  requireObject(body);
  if (body.answer !== 'yes' && body.answer !== 'no') {
    throw fail('VALIDATION_ERROR', 'answer', 'Answer must be "yes" or "no".');
  }
  return body.answer;
}
