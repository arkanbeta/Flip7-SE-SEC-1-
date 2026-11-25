import { validateCreateRoom, validateJoinRoom, validateStartAnswer, validateGameAction, validateLeave, validateReady, validateRemovePlayer } from '../validators/roomValidators.js';

// All handlers run behind requireAuth: req.userId comes from the session, never the request.
export function createRoomController({ roomService }) {
  return {
    async listModes(req, res) {
      res.json({ modes: await roomService.listModes() });
    },
    async create(req, res) {
      const room = await roomService.createRoom(req.userId, validateCreateRoom(req.body));
      res.status(201).json({ room });
    },
    async join(req, res) {
      const { code } = validateJoinRoom(req.body);
      res.json({ room: await roomService.joinRoom(req.userId, code) });
    },
    async current(req, res) {
      res.json({ room: await roomService.getCurrentRoom(req.userId) });
    },
    async leave(req, res) {
      const { confirm } = validateLeave(req.body);
      res.json(await roomService.leaveRoom(req.userId, { confirmed: confirm }));
    },
    async remove(req, res) {
      const { playerId, ban } = validateRemovePlayer(req.body);
      res.json({ room: await roomService.removePlayer(req.userId, playerId, { ban }) });
    },
    async start(req, res) {
      res.json({ room: await roomService.startGame(req.userId) });
    },
    async gameAction(req, res) {
      res.json({ room: await roomService.gameAction(req.userId, validateGameAction(req.body)) });
    },
    async rematch(req, res) {
      res.json({ room: await roomService.startRematchWithReady(req.userId) });
    },
    async fillBots(req, res) {
      res.json({ room: await roomService.fillWithBots(req.userId) });
    },
    async ready(req, res) {
      res.json({ room: await roomService.setReady(req.userId, validateReady(req.body).ready) });
    },
    async startResponse(req, res) {
      const answer = validateStartAnswer(req.body);
      res.json({ room: await roomService.respondToStartPrompt(req.userId, answer) });
    },
  };
}
