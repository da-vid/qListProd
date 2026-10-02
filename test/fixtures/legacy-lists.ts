import type { Item } from "../../src/model.ts";
const keys = [
  "10",
  "2",
  "02",
  "0",
  "-2",
  "2147483647",
  "2147483648",
  "A",
  "a",
  "ä",
];
export const legacyFixtures: {
  name: string;
  items: Item[];
  expected: string[];
}[] = [
  ...([null, 7, "legacy"] as const).map((priority) => ({
    name: `Equal ${JSON.stringify(priority)} priorities`,
    items: keys.map((key, i) => ({
      key,
      ID: String(Number(key)) === key ? Number(key) : key,
      name: `Synthetic legacy ${key}`,
      checked: i % 2 === 0,
      priority,
    })),
    expected: [
      "-2",
      "0",
      "2",
      "02",
      "10",
      "2147483647",
      "2147483648",
      "A",
      "a",
      "ä",
    ],
  })),
  {
    name: "Mixed null, numeric and string priorities",
    items: (
      [
        ["2", null],
        ["10", null],
        ["20", -5],
        ["3", 0],
        ["4", 0],
        ["5", ""],
        ["6", "Z"],
        ["7", "a"],
        ["8", "ä"],
        ["9", "aa"],
      ] as const
    ).map(([key, priority], i) => ({
      key,
      ID: Number(key),
      name: `Synthetic mixed ${key}`,
      checked: i % 2 === 0,
      priority,
    })),
    expected: ["2", "10", "20", "3", "4", "5", "6", "7", "9", "8"],
  },
];
