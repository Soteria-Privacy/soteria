// 5×7 dot-matrix glyphs, matching the banner's LED-style wordmark.
const GLYPHS: Record<string, string[]> = {
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

const PITCH = 10;
const GAP_COLS = 2;

function layout(word: string) {
  const dots: { x: number; y: number }[] = [];
  let col = 0;
  for (const ch of word) {
    GLYPHS[ch].forEach((row, r) =>
      [...row].forEach((cell, c) => {
        if (cell === "#") dots.push({ x: (col + c) * PITCH + PITCH / 2, y: r * PITCH + PITCH / 2 });
      }),
    );
    col += 5 + GAP_COLS;
  }
  return { dots, width: (col - GAP_COLS) * PITCH, height: 7 * PITCH };
}

const WORD = layout("SOTERIA");

export function DotWordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${WORD.width} ${WORD.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {WORD.dots.map((d, i) => (
        <circle key={i} className="dm-dot" cx={d.x} cy={d.y} r={4.1} />
      ))}
    </svg>
  );
}
