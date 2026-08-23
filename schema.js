// schema.js
// Single source of truth: the 35 canonical locations, in the exact column
// order used in the master Excel sheet. Do not reorder — the TSV output
// depends on this order lining up with the paste target.

const CANONICAL_LOCATIONS = [
  "UK Knuckle",
  "Al Forsan",
  "SUS PSA",
  "Terra A",
  "Metro",
  "Russian",
  "Jubilee Entrance",
  "Alif A (MOB)",
  "Alif B (VC07)",
  "Latifa PG",
  "Rashid PG",
  "ALW 2",
  "ALW 3",
  "ALW 4",
  "Sales Center",
  "SA01",
  "SA02",
  "SA03",
  "SA05",
  "SR03",
  "SS03",
  "OA06",
  "OS02",
  "OA04",
  "OA07",
  "OA08",
  "OA03",
  "Nestle",
  "OA05",
  "OA09",
  "MS01",
  "MS03",
  "MA01",
  "MA06",
  "MS02",
];

// Your sheet has TWO columns to skip between the two location groups:
// column K holds your own Total formula for the first group (never write
// there), and column L is a genuinely blank spacer column. Latifa PG then
// starts the second group at M. So after "Alif B (VC07)"'s value, two
// blank cells go into the copy output before Latifa PG's value.
const GAP_AFTER_LOCATION = "Alif B (VC07)";
const GAP_CELL_COUNT = 2;

// Normalizer: strips spaces, hyphens, apostrophes, parens, asterisks, dots,
// uppercases. Used both to seed aliases below and to match incoming text.
function normalizeKey(str) {
  return String(str)
    .toUpperCase()
    .replace(/[\s\-'’.()*]/g, "");
}

// Seed aliases discovered from real ground-team messages/images so far.
// Left side = normalized form of what people actually type.
// Right side = canonical name from CANONICAL_LOCATIONS above.
// This is merged with anything the user teaches the app at runtime
// (stored in localStorage), and localStorage entries always win on conflict.
const SEED_ALIASES = {
  "SUSPLAZA": "SUS PSA",
  "SUS": "SUS PSA",
  "TERRAA": "Terra A",
  "METRO": "Metro",
  "UKKNUCKLE": "UK Knuckle",
  "ALFORSAN": "Al Forsan",
  "RUSSIAN": "Russian",
  "JUBILEEENTRANCE": "Jubilee Entrance",
  "JUBILEE": "Jubilee Entrance",
  "MOBILITY": "Alif A (MOB)",
  "ALIFA": "Alif A (MOB)",
  "ALIFAMOB": "Alif A (MOB)",
  "VC07": "Alif B (VC07)",
  "ALIFB": "Alif B (VC07)",
  "ALIFBVC07": "Alif B (VC07)",
  "LATIFAPLAYGROUND": "Latifa PG",
  "LATIFAPG": "Latifa PG",
  "RASHIDSADVENTURE": "Rashid PG",
  "RASHIDADVENTURE": "Rashid PG",
  "RASHIDPG": "Rashid PG",
  "ALWASL2": "ALW 2",
  "ALW2": "ALW 2",
  "ALWASL3": "ALW 3",
  "ALW3": "ALW 3",
  "ALWASL4": "ALW 4",
  "ALW4": "ALW 4",
  "ALWASL": "ALW 2", // ambiguous on its own — will still prompt if unresolved
  "SALESCENTER": "Sales Center",
  "SALECENTER": "Sales Center",
  "ARRIVALPLAZA": "SUS PSA",
  "TERRAAPARKING": "Terra A",
  "ALWASLAVENUE": "Metro", // ground-team confirmed: mislabeled Metro in Sustainability reports
  "SS06": "Sales Center", // per ground-team confirmation: SS-06 refers to Sales Center
  "SA01": "SA01",
  "SA02": "SA02",
  "SA03": "SA03",
  "SA05": "SA05",
  "SR03": "SR03",
  "SS03": "SS03",
  "SSO3": "SS03", // common OCR/typo confusion of 0 vs O
  "OA06": "OA06",
  "OS02": "OS02",
  "OA04": "OA04",
  "OA07": "OA07",
  "OA08": "OA08",
  "OA03": "OA03",
  "NESTLE": "Nestle",
  "OA05": "OA05",
  "OA09": "OA09",
  "MS01": "MS01",
  "MS03": "MS03",
  "MA01": "MA01",
  "MA06": "MA06",
  "MS02": "MS02",
};

if (typeof module !== "undefined") {
  module.exports = { CANONICAL_LOCATIONS, SEED_ALIASES, normalizeKey, GAP_AFTER_LOCATION, GAP_CELL_COUNT };
}
