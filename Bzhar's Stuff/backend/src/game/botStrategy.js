// How a computer player decides. Shared by the server's own bots (services/botService.js)
// and the developer script scripts/bots.js, so both play the same way.
//
// Deliberately simple: no card counting. `game` is the view every player receives
// (games.view / room.game) and `me` is the bot's user id.

const score = (game, id) => game.players.find((p) => p.id === id)?.roundScore ?? 0;

export function chooseMove(game, me) {
  const d = game.decision;
  const mine = game.players.find((p) => p.id === me);
  if (d.type === 'hit_or_stay') {
    // Stay once the hand is worth a fair amount, unless a Second Chance covers the risk.
    const risky = mine.numbers.length >= 5 || mine.roundScore >= 25;
    return { type: risky && !mine.hasSecondChance ? 'stay' : 'hit' };
  }
  if (d.type === 'choose_target') {
    // Freeze / Flip Three: aim at the opponent with the best round so far.
    const others = d.options.filter((id) => id !== me);
    const pick = others.sort((a, b) => score(game, b) - score(game, a))[0] ?? me;
    return { type: 'target', targetId: pick };
  }
  return { type: 'gift', targetId: d.options[0] };
}
