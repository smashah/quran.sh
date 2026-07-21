Output demos/quran-next-generation.mp4
Output demos/quran-next-generation.gif

Require bun

Set Shell "zsh"
Set FontFamily "Menlo"
Set FontSize 18
Set Width 1280
Set Height 800
Set Padding 12
Set Framerate 30
Set TypingSpeed 35ms
Set Theme {"background":"#05070b","foreground":"#f2ead8","black":"#05070b","brightBlack":"#60727a","red":"#b85c62","brightRed":"#d47b7f","green":"#668b72","brightGreen":"#89aa91","yellow":"#d8b45d","brightYellow":"#efd98a","blue":"#476672","brightBlue":"#7797a5","magenta":"#806a8c","brightMagenta":"#aa8eb5","cyan":"#6d9298","brightCyan":"#9bc0c5","white":"#d8dedc","brightWhite":"#fffaf0"}
Env XDG_DATA_HOME "/tmp/quran-sh-vhs-v070"

Hide
Type "rm -rf /tmp/quran-sh-vhs-v070 && mkdir -p /tmp/quran-sh-vhs-v070 && clear"
Enter
Show

Type "bun src/index.ts immersive"
Enter
Sleep 3s

Down
Sleep 800ms
Down
Sleep 800ms
Type "2"
Sleep 1s
Type "w"
Sleep 2s
Type "4"
Sleep 1s
Type "3"
Sleep 1s
Type "p"
Sleep 2s
Type "g"
Sleep 2s
Type "g"
Sleep 3s
Type "g"
Sleep 1s
Type "q"
Sleep 1s

Type "bun src/index.ts stream"
Enter
Sleep 2s
Down
Sleep 1s
Down
Sleep 1s
Down
Sleep 2s
Type "q"
Sleep 1s

Type "bun src/index.ts doctor"
Enter
Sleep 3s
