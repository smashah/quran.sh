Output demos/quran-v0.7.1-dialogs.mp4
Output demos/quran-v0.7.1-dialogs.gif

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
Env XDG_DATA_HOME "/tmp/quran-sh-vhs-v071"

Hide
Type "rm -rf /tmp/quran-sh-vhs-v071 && mkdir -p /tmp/quran-sh-vhs-v071 && clear"
Enter
Show

Type "bun src/index.ts immersive"
Enter
Sleep 3s

Type "p"
Sleep 3s
Type "d"
Sleep 5s
Type "y"
Sleep 4s
Type "p"
Sleep 1s

Type "g"
Sleep 3s
Type "f"
Sleep 3s
Type "g"
Sleep 1s
Type "g"
Sleep 2s
Type "y"
Sleep 4s
Down
Sleep 2s
Type "g"
Sleep 1s

Type "v"
Sleep 3s
Escape
Sleep 1s
Type "q"
Sleep 1s

Type "bun src/index.ts doctor --gpu"
Enter
Sleep 4s
