export function TerminalIllumination({ verseKey }: { readonly verseKey: string }) {
  const [surah = 1, ayah = 1] = verseKey.split(":").map(Number);
  const ornaments = ["◇", "✦", "◈", "✧"] as const;
  const ornament = ornaments[(surah * 3 + ayah) % ornaments.length];
  const span = 5 + ((surah + ayah) % 6);
  return (
    <box width="100%" flexDirection="column" alignItems="center">
      <text fg="#496a72">{`${ornament} ${"─".repeat(span)} ☾ ${"─".repeat(span)} ${ornament}`}</text>
      <text fg="#294750">{`╲ ${"· ".repeat(Math.max(3, Math.floor(span / 2)))}${ornament} ${"· ".repeat(Math.max(3, Math.floor(span / 2)))}╱`}</text>
    </box>
  );
}
