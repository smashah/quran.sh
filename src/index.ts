#!/usr/bin/env bun

const TOTAL_SURAHS = 114;

function showUsage(): void {
  console.log(`quran.sh — Read the Quran from your terminal

Usage:
  quran.sh [command] [options]

Commands:
  (none)           Launch the interactive dashboard reader
  read   <ref>     Read a surah or verse
  log    <ref>     Log a surah or verse as read
  search <query>   Search verse translations
  streak           Show reading stats and streaks
  resources [...]  Install or manage attributed optional content packs
  immersive        Launch the experimental focused reader
  stream           Read with completed ayat in terminal scrollback
  safe              Launch the dashboard with optional features disabled
  doctor            Inspect capabilities, packs, caches, and licenses (--gpu probes WebGPU)
  models [...]      Install, verify, or remove optional Tilawa assets

Reference formats:
  1                Full surah by number (1-${TOTAL_SURAHS})
  1:1              Single verse (surah:verse)
  al-fatihah       Full surah by name

Examples:
  quran                    Launch TUI
  quran read 1             Al-Fatihah (full surah)
  quran read 1:1           First verse of Al-Fatihah
  quran search merciful    Search for "merciful"
  quran streak             Show current streak`);
}

async function main(): Promise<number | undefined> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    const { launchTui } = await import("./tui/launch.ts");
    await launchTui();
    return;
  }

  if (command === "--help" || command === "-h") {
    showUsage();
    return 0;
  }

  if (command === "streak") {
    const { runStreak } = await import("./cli/commands.ts");
    return runStreak();
  }

  if (command === "search") {
    const { runSearch } = await import("./cli/commands.ts");
    return runSearch(args.slice(1).join(" "));
  }

  if (command === "resources") {
    const { runResourceCommand } = await import("./features/resources/cli.ts");
    return runResourceCommand(args.slice(1));
  }

  if (command === "immersive" || command === "classic" || command === "stream" || command === "safe") {
    const { launchTui } = await import("./tui/launch.ts");
    const experience = command === "classic" || command === "safe" ? "reader" : command;
    await launchTui({ experience, safeMode: command === "safe" });
    return;
  }

  if (command === "doctor") {
    const { runDoctor } = await import("./features/doctor.ts");
    return runDoctor(args.slice(1));
  }

  if (command === "models") {
    const { runModelCommand } = await import("./features/recognition/cli.ts");
    return runModelCommand(args.slice(1));
  }

  if (command !== "read" && command !== "log") {
    console.error(`Error: Unknown command "${command}". Run with --help for usage.`);
    return 1;
  }

  const ref = args[1];
  if (!ref) {
    console.error(`Error: Missing reference. Usage: quran.sh ${command} <ref>`);
    return 1;
  }

  const { runReferenceCommand } = await import("./cli/commands.ts");
  return runReferenceCommand(command, ref);
}

main()
  .then((exitCode) => {
    if (exitCode !== undefined) process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error("quran.sh failed:", error);
    process.exitCode = 1;
  });
