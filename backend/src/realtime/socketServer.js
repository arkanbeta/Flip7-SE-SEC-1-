import { Server } from 'socket.io';

const MAX_SOCKETS_PER_USER = 5; // several tabs/devices are fine, a flood is not
const DEFAULT_GRACE_MS = 30_000;

// Real-time layer (Phase 5). The design is deliberately small:
//
//   * The server PUSHES. After every change to a room it sends each affected player their
//     own view of it as `room:state` ({ room } or { room: null }). The view is built per
//     player because the start question is only for the creator.
//   * The browser ACTS through the normal HTTP endpoints (create, join, leave, start...).
//     They already have CSRF protection, validation and rate limits, so the socket needs
//     no input handlers at all: it ignores everything the browser sends.
//   * Who you are comes ONLY from the login session cookie, read when the connection is
//     opened. Connections from other websites or without a login are refused.
//   * A player whose last connection drops keeps their seat for a grace period (a page
//     refresh or a bad connection must not kick them out). If they do not come back they
//     leave the room through the normal leave rules (creator of a waiting room -> the room
//     is terminated; creator during a match -> ownership moves on).
//
// Redis-ready: with several backend instances the in-memory pieces (this file's maps and
// the RoomManager) would be replaced by the Socket.IO Redis adapter plus shared state.
export function attachRealtime({
  httpServer,
  config,
  sessionMiddleware,
  roomService,
  manager,
  graceMs = config.rooms?.disconnectGraceMs ?? DEFAULT_GRACE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  logger = console,
}) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 1024, // we never expect anything from the browser
    serveClient: false,
    // Browsers do not apply CORS to WebSockets, so the Origin is checked here too.
    // (Requests without an Origin are not browsers, so they cannot ride on a victim's cookie.)
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      callback(null, !origin || origin === config.clientOrigin);
    },
    cors: { origin: config.clientOrigin, credentials: true },
  });

  // Run the same session middleware as the HTTP API, then require a signed-in user.
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error('AUTH_REQUIRED'));
    socket.data.userId = userId;
    return next();
  });

  const socketsOf = new Map(); // userId -> Set of socket ids
  const graceTimers = new Map(); // userId -> timer

  const connectionCount = (userId) => socketsOf.get(userId)?.size ?? 0;

  function cancelGrace(userId) {
    const timer = graceTimers.get(userId);
    if (timer) clearTimer(timer);
    graceTimers.delete(userId);
  }

  function startGrace(userId) {
    if (graceTimers.has(userId) || connectionCount(userId) > 0) return;
    const timer = setTimer(async () => {
      graceTimers.delete(userId);
      if (connectionCount(userId) > 0 || !manager.getRoomOfUser(userId)) return;
      try {
        await roomService.leaveRoom(userId, { confirmed: true }); // the server decides here, not the player
        logger.info?.(`Player ${userId} did not reconnect in time and left their room.`);
      } catch (error) {
        logger.error('Could not remove a disconnected player from their room:', error);
      }
    }, graceMs);
    timer.unref?.();
    graceTimers.set(userId, timer);
  }

  // Sends one player their current view of their room (or `null`).
  // `reason` ('kicked' | 'banned') tells a removed player why their room is gone.
  async function push(userId, reason) {
    try {
      const room = await roomService.getCurrentRoom(userId);
      io.to(`user:${userId}`).emit('room:state', { room, reason });
    } catch (error) {
      logger.error('Could not send room state:', error);
    }
  }

  // Every room change reaches every affected player; players with no open connection start
  // their grace period (this also covers someone who creates a room over HTTP and never
  // opens the page).
  const unsubscribe = manager.subscribe(({ type, room, userIds }) => {
    const affected = new Set([...room.members.keys(), ...userIds]);
    const removed = type === 'kicked' || type === 'banned' ? type : undefined;
    for (const userId of affected) {
      push(userId, room.members.has(userId) ? undefined : removed);
      if (room.members.has(userId)) startGrace(userId);
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    const set = socketsOf.get(userId) ?? new Set();
    if (set.size >= MAX_SOCKETS_PER_USER) {
      socket.disconnect(true);
      return;
    }
    set.add(socket.id);
    socketsOf.set(userId, set);
    cancelGrace(userId);
    socket.join(`user:${userId}`);

    // Everything a (re)connecting browser needs: its authoritative current state.
    push(userId);

    socket.on('disconnect', () => {
      set.delete(socket.id);
      if (set.size === 0) {
        socketsOf.delete(userId);
        if (manager.getRoomOfUser(userId)) startGrace(userId);
      }
    });
  });

  return {
    io,
    // Used on logout: a signed-out browser must not keep receiving updates.
    disconnectUser(userId) {
      if (userId) io.in(`user:${userId}`).disconnectSockets(true);
    },
    connectionCount,
    close() {
      unsubscribe();
      for (const timer of graceTimers.values()) clearTimer(timer);
      graceTimers.clear();
      io.close();
    },
  };
}
