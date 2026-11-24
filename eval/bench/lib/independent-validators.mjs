// Independently written checksum code, used ONLY by the benchmark and its tests.
// It derives the Verhoeff tables from group theory instead of copying them, so a
// typo in the production tables cannot hide itself.

// Dihedral group D5 on 0..9: 0-4 rotations, 5-9 reflections.
function mult(a, b) {
  if (a < 5 && b < 5) return (a + b) % 5;
  if (a < 5) return ((a + b) % 5) + 5;
  if (b < 5) return ((a - b + 5) % 5) + 5;
  return (a - b + 5) % 5;
}
const base = [1, 5, 7, 6, 2, 8, 3, 0, 9, 4];
const perms = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]];
for (let i = 1; i < 8; i++) perms.push(perms[i - 1].map((_, d) => base[perms[i - 1][d]]));
const inverse = (x) => { for (let y = 0; y < 10; y++) if (mult(x, y) === 0) return y; };

export function verhoeffOk(s) {
  let c = 0;
  [...String(s)].reverse().forEach((ch, i) => { c = mult(c, perms[i % 8][+ch]); });
  return c === 0;
}
export function withVerhoeff(payload) {
  let c = 0;
  [...String(payload)].reverse().forEach((ch, i) => { c = mult(c, perms[(i + 1) % 8][+ch]); });
  return String(payload) + inverse(c);
}
export function luhnOk(s) {
  const d = [...String(s)].reverse().map(Number);
  return d.reduce((sum, x, i) => sum + (i % 2 ? (x * 2 > 9 ? x * 2 - 9 : x * 2) : x), 0) % 10 === 0;
}
export function withLuhn(payload) {
  for (let c = 0; c < 10; c++) if (luhnOk(String(payload) + c)) return String(payload) + c;
}
