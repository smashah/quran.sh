/**
 * Arabic rendering test harness — FrameBuffer + Reshaper edition.
 * Run: bun run src/dev/rtl-test.tsx
 *
 * Tests: "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ"
 */
import {
  FrameBufferRenderable,
  TextRenderable,
  TextAttributes,
  RGBA,
  createCliRenderer,
} from "@opentui/core";
// @ts-ignore — no types
import ArabicReshaper from "arabic-reshaper";

const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";
const SHAPED = ArabicReshaper.convertArabic(BASMALA) as string;

// Log to stderr so we can see the raw strings
console.error("Original :", BASMALA);
console.error("Shaped   :", SHAPED);
console.error("Reversed :", [...BASMALA].reverse().join(""));
console.error("Shaped+Rev:", [...SHAPED].reverse().join(""));

const W = RGBA.fromHex("#FFFFFF");
const B = RGBA.fromHex("#000000");
const CYAN = RGBA.fromHex("#00CCCC");
const YELLOW = RGBA.fromHex("#CCCC00");
const GREEN = RGBA.fromHex("#00CC00");
const MAGENTA = RGBA.fromHex("#CC00CC");
const RED = RGBA.fromHex("#CC0000");

async function main() {
  const renderer = await createCliRenderer();
  const root = renderer.root;
  const FBW = 70;

  function label(text: string, color: RGBA) {
    root.add(new TextRenderable(renderer, {
      id: `l-${Math.random().toString(36).slice(2, 6)}`,
      content: `▸ ${text}`,
      attributes: TextAttributes.BOLD,
      fg: color,
    }));
  }

  function fb(drawFn: (fb: any) => void) {
    const canvas = new FrameBufferRenderable(renderer, {
      id: `fb-${Math.random().toString(36).slice(2, 6)}`,
      width: FBW,
      height: 1,
    });
    drawFn(canvas.frameBuffer);
    root.add(canvas);
    // spacer
    root.add(new TextRenderable(renderer, {
      id: `s-${Math.random().toString(36).slice(2, 6)}`,
      content: "",
    }));
  }

  // ═══════════════════════════════════════════════════
  // 1. Original string — drawText
  // ═══════════════════════════════════════════════════
  label("1. drawText(original)", CYAN);
  fb((f) => f.drawText(BASMALA, 0, 0, W));

  // ═══════════════════════════════════════════════════
  // 2. Reversed chars — drawText
  // ═══════════════════════════════════════════════════
  label("2. drawText(reversed chars) — disconnected", YELLOW);
  fb((f) => f.drawText([...BASMALA].reverse().join(""), 0, 0, W));

  // ═══════════════════════════════════════════════════
  // 3. Reshaped — drawText (should be connected but LTR)
  // ═══════════════════════════════════════════════════
  label("3. drawText(reshaped) — connected but LTR?", GREEN);
  fb((f) => f.drawText(SHAPED, 0, 0, W));

  // ═══════════════════════════════════════════════════
  // 4. Reshaped + reversed — drawText (connected AND RTL)
  // ═══════════════════════════════════════════════════
  label("4. drawText(reshaped + reversed) — THE GOAL ★", MAGENTA);
  fb((f) => {
    const shapedReversed = [...SHAPED].reverse().join("");
    f.drawText(shapedReversed, 0, 0, W);
  });

  // ═══════════════════════════════════════════════════
  // 5. Reshaped + reversed + right-aligned
  // ═══════════════════════════════════════════════════
  label("5. drawText(reshaped+reversed) right-aligned", RED);
  fb((f) => {
    const shapedReversed = [...SHAPED].reverse().join("");
    const len = [...shapedReversed].length;
    f.drawText(shapedReversed, FBW - len, 0, W);
  });

  // ═══════════════════════════════════════════════════
  // 6. Reshaped — setCell RTL placement
  // ═══════════════════════════════════════════════════
  label("6. setCell(reshaped) RTL cell-by-cell from right", CYAN);
  fb((f) => {
    const chars = [...SHAPED];
    let x = FBW - 1;
    for (const ch of chars) {
      if (x < 0) break;
      f.setCell(x, 0, ch, W, B);
      x--;
    }
  });

  // ═══════════════════════════════════════════════════
  // 7. Reshaped per-word drawText placed RTL
  // ═══════════════════════════════════════════════════
  label("7. drawText per-word (reshaped), placed RTL", YELLOW);
  fb((f) => {
    const words = SHAPED.split(" ");
    let x = FBW - 1;
    for (const word of words) {
      const wordLen = [...word].length;
      x -= wordLen;
      if (x < 0) break;
      f.drawText(word, x, 0, W);
      x -= 1;
    }
  });
}

main();
