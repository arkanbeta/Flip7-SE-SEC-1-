// The rules content, as DATA. The page just renders whatever is listed here, so adding a
// mode later means adding one object to MODE_RULES (and one row to the GameModes table).
//
// A mode's `sections` is a list of { heading, paragraphs?: string[], items?: string[] }.
// An empty `sections` list shows the "rules not provided yet" notice.
//
// The Normal Mode text below is taken from the project owner's rules document
// (Flip 7 Ruleset Edition 3.1, Op Games). Do not change it from memory: change it only
// when the owner changes the rules.
export const MODE_RULES = [
  {
    id: 'normal',
    label: 'Normal Mode',
    summary: 'The standard way to play Flip 7.',
    sections: [
      {
        heading: 'Goal',
        paragraphs: [
          'Flip 7 is a press-your-luck card game. On your turn you either take another card (Hit) or stop and bank your round score (Stay). Drawing a number you already have busts you and wipes out your score for that round.',
          'The game ends after the round in which at least one player reaches 200 points. The player with the most points wins. If players are tied for the top score above 200, extra rounds are played until there is a single winner.',
        ],
      },
      {
        heading: 'The deck (94 cards)',
        items: [
          'Number cards, 79 in total: one 0, one 1, two 2s, three 3s, and so on up to twelve 12s. Each is worth its number. The 0 is worth nothing but counts as a different number.',
          'Score Modifier cards, 6 in total: +2, +4, +6, +8, +10 and x2 (one of each).',
          'Action cards, 9 in total: three Freeze, three Flip Three and three Second Chance.',
        ],
        // Pictures of the cards as they look at the table (shown under the text, not part of it).
        cards: [
          { label: '7', name: 'Number card 7' },
          { kind: 'modifier', label: '+4', name: 'Score Modifier +4' },
          { kind: 'modifier', label: 'x2', name: 'Score Modifier x2' },
          { kind: 'freeze', caption: 'Freeze', name: 'Freeze' },
          { kind: 'flip_three', caption: 'Flip Three', name: 'Flip Three' },
          { kind: 'second_chance', caption: 'Second Chance', name: 'Second Chance' },
        ],
      },
      {
        heading: 'Setting up a round',
        items: [
          'The deck is shuffled and one player is the dealer.',
          'The dealer deals one card face-up to every player, including themselves.',
          'If an Action card appears during the deal, dealing pauses while it is resolved, then continues until everyone has a card.',
          'Then each player in turn chooses Hit or Stay. You can only Stay once you have at least one card.',
        ],
      },
      {
        heading: 'Hit or Stay',
        items: [
          'Hit: you receive the next card. A new Number card is added to your line. A Score Modifier goes with your modifiers. An Action card is resolved as described below.',
          'Stay: you stop drawing for the rest of the round and your current score is secured. You cannot re-enter the round.',
          'A player is inactive after they Stay, are Frozen or Bust. Inactive players take no more turns that round.',
        ],
      },
      {
        heading: 'Busting and Second Chance',
        items: [
          'You bust when you receive a Number card whose number is already in your line. You are out of the round and score zero for it. Points from earlier rounds are kept.',
          'Second Chance: keep it in front of you. If you later draw a duplicate Number card, only the Second Chance is discarded: the duplicate stays in your line and its points count. You avoid the bust and stay in the round, but you do not take another turn straight away. A further copy of that number busts you as usual, and Flip 7 still needs seven different numbers. (House rule of this online version: the printed rules discard the duplicate too.)',
          'You can hold only one Second Chance. If you receive another, give it to another active player who does not have one, or discard it if nobody qualifies.',
          'Second Chance only prevents a bust from a duplicate Number card. It does not cancel Freeze or another Action card. Unused Second Chance cards are discarded at the end of the round.',
        ],
      },
      {
        heading: 'Action cards',
        paragraphs: [
          'An Action card can be played on any active player, including the player who received it. If that player is the only active one, they must play it on themselves.',
        ],
        items: [
          'Freeze: the target banks their points and is out of the round. This is not a bust: they keep their score.',
          'Flip Three: the target must accept the next three cards, one at a time. Number, Score Modifier and Action cards all count toward the three. If the target busts, the sequence stops and they score zero. If they collect seven unique Number cards, the round ends at once. A Freeze or Flip Three drawn during the sequence waits until all three cards have been drawn, and is then resolved if the target has not busted. A Second Chance drawn during the sequence can be kept and used.',
        ],
      },
      {
        heading: 'Score Modifier cards',
        items: [
          '+2, +4, +6, +8 and +10 add their value to your score.',
          'x2 doubles the total of your Number cards only. It does not double the + cards or the Flip 7 bonus.',
          'Modifiers cannot cause a bust and do not count toward Flip 7. A + card still scores even if you have no Number cards. An x2 on its own scores zero.',
        ],
      },
      {
        heading: 'Flip 7 bonus',
        paragraphs: [
          'If you have seven different Number cards face-up (the 0 counts), you achieve Flip 7. The round ends immediately for everyone and you receive a flat 15 point bonus. Players who busted score zero; players who already Stayed or were Frozen keep their secured scores.',
        ],
      },
      {
        heading: 'Ending a round and scoring',
        items: [
          'A round ends when no active players remain, or as soon as a player achieves Flip 7.',
          'Round score = (sum of your Number cards, doubled if you have x2) + your +2/+4/+6/+8/+10 cards + 15 if you achieved Flip 7.',
          'Example: Number cards 3, 5, 8 and 11 add up to 27; x2 makes 54; +4 and +8 add 12, giving 66. With Flip 7 it would be 81.',
        ],
      },
      {
        heading: 'Next round and end of the game',
        items: [
          'Cards from the finished round are set aside and the next round continues with the remaining draw deck. When the deck runs out, the discarded cards are shuffled into a new one.',
          'The dealer role passes to the next player.',
          'After scoring, if at least one player has 200 or more points, the game is over and the player with the most points wins. A round is always finished before the winner is decided.',
        ],
      },
    ],
  },
];
