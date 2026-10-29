#!/usr/bin/env bun

const TOTAL_SURAHS = 114;
const LANGUAGE_CODES = "bn en es fr id ru sv tr ur zh";

function showUsage(): void {
  console.log(`quran.sh — Read the Quran from your terminal

Usage:
  quran [command] [options]        (run without installing: bunx quran.sh)

Readers (interactive):
  quran                    Dashboard: surah list, bookmarks, cues, reflections, reading stats
  quran immersive [ref]    One ayah at a time with tafsir, hadith, recitation and 3D views
  quran stream [ref]       Minimal reader; finished ayat stay in your terminal scrollback
  quran safe               Dashboard with every optional online or heavy feature turned off
                           (quran classic is another name for the dashboard)

  All three readers share your position, bookmarks and reading history.
  Press ? inside any reader for its keys.

Commands:
  read   <ref> [options]   Print a surah or verse
  search <query> [options] Search translations and Arabic text
  log    <ref>             Log a surah or verse as read
  streak                   Show reading streaks
  resources [...]          Install or manage attributed optional content packs
  models [...]             Install, verify, or remove optional Tilawa assets
  doctor [--gpu]           Inspect capabilities, packs, caches, and licenses
  help                     Show this help

Options for read and search:
  -l, --lang <code>        Translation language: ${LANGUAGE_CODES} (default: en)
  -a, --arabic             Include the Arabic text (read)
  -n, --numbers            Prefix every verse with its reference (read)

References:
  2                        Surah by number (1-${TOTAL_SURAHS})
  2:255                    Single verse (surah:verse)
  al-baqarah               Surah by name; spelling is forgiving (baqarah, Al-Baqara, the cow)
  baqarah 255              Surah name plus verse

Examples:
  quran                    Launch the dashboard
  quran read 1             Al-Fatihah (full surah)
  quran read 1:1 --arabic  First verse with its Arabic text
  quran read yasin -l ur   Ya-Sin in Urdu
  quran search merciful    Search for "merciful"
  quran immersive 2:255    Open the immersive reader at Ayat al-Kursi
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

  if (command === "--help" || command === "-h" || command === "help") {
    showUsage();
    return 0;
  }

  if (command === "immersive" || command === "classic" || command === "stream" || command === "safe") {
    const experience = command === "classic" || command === "safe" ? "reader" : command;
    const ref = args.slice(1).join(" ").trim();
    let initialVerseKey: `${number}:${number}` | undefined;
    if (ref) {
      if (experience === "reader") {
        console.error(`Error: "quran ${command}" doesn't take a reference. Try "quran immersive ${ref}" or "quran read ${ref}".`);
        return 1;
      }
      const { parseQuranReference } = await import("./data/reference.ts");
      const parsed = parseQuranReference(ref);
      if (!parsed.ok) {
        console.error(`Error: ${parsed.message}`);
        return 1;
      }
      initialVerseKey = `${parsed.surahId}:${parsed.verseId ?? 1}`;
    }
    const { launchTui } = await import("./tui/launch.ts");
    await launchTui({ experience, safeMode: command === "safe", initialVerseKey });
    return;
  }

  if (command === "streak" || command === "search" || command === "read" || command === "log") {
    const { parseCommandOptions, runReferenceCommand, runSearch, runStreak } = await import("./cli/commands.ts");
    const parsed = parseCommandOptions(command, args.slice(1));
    if (!parsed.ok) {
      console.error(`Error: ${parsed.message}`);
      return 1;
    }
    if (command === "streak") return runStreak();
    if (command === "search") return runSearch(parsed.positional.join(" "), parsed.options);
    const ref = parsed.positional.join(" ").trim();
    if (!ref) {
      console.error(`Error: Missing reference. Usage: quran ${command} <ref>   (for example: quran ${command} 2:255)`);
      return 1;
    }
    return runReferenceCommand(command, ref, parsed.options);
  }

  if (command === "resources") {
    const { runResourceCommand } = await import("./features/resources/cli.ts");
    return runResourceCommand(args.slice(1));
  }

  if (command === "doctor") {
    const { runDoctor } = await import("./features/doctor.ts");
    return runDoctor(args.slice(1));
  }

  if (command === "models") {
    const { runModelCommand } = await import("./features/recognition/cli.ts");
    return runModelCommand(args.slice(1));
  }

  console.error(`Error: Unknown command "${command}". Run "quran help" for usage.`);
  return 1;
}

main()
  .then((exitCode) => {
    if (exitCode !== undefined) process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error("quran.sh failed:", error);
    process.exitCode = 1;
  });
