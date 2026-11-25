// Turns an engine event into a plain sentence for the activity feed.
// `nameOf(id)` returns a player's nickname. Nothing here decides anything; it only words
// what the server already decided.
const ACTION_NAMES = { freeze: 'Freeze', flip_three: 'Flip Three', second_chance: 'Second Chance' };

export function describeEvent(e, nameOf) {
  const who = e.playerId != null ? nameOf(e.playerId) : '';
  const target = e.targetId != null ? nameOf(e.targetId) : '';
  switch (e.type) {
    case 'round_started':
      return `Round ${e.round} begins. ${nameOf(e.dealerId)} is the dealer.`;
    case 'card_dealt':
      return `${who} ${e.via === 'hit' ? 'draws' : e.via === 'flip_three' ? 'is forced to draw' : 'is dealt'} ${e.card.label}.`;
    case 'player_hit':
      return null; // the next line (the card drawn) says it all
    case 'player_stayed':
      return `${who} stays with ${e.roundScore} points.`;
    case 'player_busted':
      return `${who} busts with a second ${e.card.label}!`;
    case 'flip_three_stopped':
      return `Flip Three stops: ${e.remaining === 1 ? 'the last card stays' : `the other ${e.remaining} cards stay`} on the deck.`;
    case 'second_chance_used':
      return `${who}'s Second Chance cancels the duplicate ${e.card.label}.`;
    case 'second_chance_discarded':
      return `${who}'s spare Second Chance is discarded.`;
    case 'second_chance_given':
      return `${who} gives a Second Chance to ${target}.`;
    case 'action_resolved':
      return `${who} plays ${e.card.label} on ${who === target ? 'themselves' : target}.`;
    case 'action_set_aside':
      return `${who} draws ${e.card.label}; it waits until the three cards are drawn.`;
    case 'flip7_achieved':
      return `${who} flips 7 different numbers! The round ends (+15).`;
    case 'deck_reshuffled':
      return 'The discard pile is shuffled into a new deck.';
    case 'player_left':
      return `${who} left the match.`;
    case 'round_scored':
      return 'The round is over. Scores are in.';
    case 'match_completed':
      return e.winnerIds.length === 1 ? `${nameOf(e.winnerIds[0])} wins the match!` : 'The match is over.';
    default:
      return null;
  }
}

export const actionName = (action) => ACTION_NAMES[action] ?? action;
