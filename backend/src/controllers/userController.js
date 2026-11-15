import { AppError } from '../utils/AppError.js';
import { validateProfileUpdate, validateLimit } from '../validators/profileValidators.js';

// Every handler here runs behind requireAuth, so req.userId comes from the session.
export function createUserController({ userService, profileService }) {
  const notFound = () => new AppError(404, 'USER_NOT_FOUND', 'Your account could not be found.');

  async function getMe(req, res) {
    const user = await userService.findById(req.userId);
    if (!user) throw notFound();
    res.json({ user, stats: await profileService.getStats(req.userId) });
  }

  async function getMyMatches(req, res) {
    const limit = validateLimit(req.query.limit);
    res.json({ matches: await profileService.getRecentMatches(req.userId, limit) });
  }

  async function updateMe(req, res) {
    const updates = validateProfileUpdate(req.body);
    const user = await userService.updateProfile(req.userId, updates);
    if (!user) throw notFound();
    res.json({ user });
  }

  return { getMe, getMyMatches, updateMe };
}
