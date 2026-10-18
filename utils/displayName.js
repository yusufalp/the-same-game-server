export function generateDisplayName() {
  const adjectives = [
    "Swift",
    "Brave",
    "Clever",
    "Happy",
    "Lucky",
    "Mighty",
    "Silent",
    "Bright",
  ];
  const animals = [
    "Fox",
    "Panda",
    "Tiger",
    "Owl",
    "Dolphin",
    "Wolf",
    "Eagle",
    "Koala",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj} ${animal}`;
}

// Uses the name the player typed, otherwise a random one that
// isn't already taken by someone else in the same game.
export function pickDisplayName(requested, takenNames = []) {
  const typed =
    typeof requested === "string" ? requested.trim().slice(0, 20) : "";
  if (typed) return typed;

  const taken = new Set(takenNames);
  for (let i = 0; i < 10; i++) {
    const candidate = generateDisplayName();
    if (!taken.has(candidate)) return candidate;
  }
  return generateDisplayName();
}
