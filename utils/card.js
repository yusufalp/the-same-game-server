import { randomInt } from "node:crypto";

export const ATTRIBUTES = ["number", "color", "category"];

// Chance that the computer "remembers" a matching partner for its second card.
const COMPUTER_MEMORY = 1;

const randomItem = (items) => items[randomInt(items.length)];
export const cardsMatch = (a, b, attribute) => a[attribute] === b[attribute];

// Fisher-Yates shuffle using a cryptographic random source.
export function shuffle(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = (randomInt(i + 1)[(result[i], result[j])] = [
      result[j],
      result[i],
    ]);
  }

  return result;
}

// Attributes for which at least two of these cards share a value.
export function availableAttributes(cards) {
  return ATTRIBUTES.filter((attribute) => {
    const seen = new Set();
    return cards.some((card) => {
      if (seen.has(card[attribute])) return true;
      seen.add(card[attribute]);
      return false;
    });
  });
}

// The spinner only lands on an attribute that still has a possible match,
// so a player is never handed an impossible turn. Null = no match is possible.
export function pickSpinAttribute(cards) {
  const options = availableAttributes(cards);
  return options.length ? randomItem(options) : null;
}

// Which slot a computer player flips. `cards` are the unmatched cards.
// First card: random. Second card: sometimes "remembers" a real partner.
export function pickComputerSlot(cards, attribute, firstCard = null) {
  const options = cards.filter(
    (card) => !firstCard || card.slot !== firstCard.slot,
  );

  if (firstCard && Math.random() < COMPUTER_MEMORY) {
    const partners = options.filter((card) =>
      cardsMatch(card, firstCard, attribute),
    );
    if (partners.length) return randomItem(partners).slot;
  }

  return randomItem(options).slot;
}
