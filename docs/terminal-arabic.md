# Arabic rendering support

quran.sh preserves the logical Quran text and offers a one-time RTL calibration because terminal shaping is not standardized. Some terminals shape Arabic and apply BiDi themselves; others need presentation forms, line reversal, or explicit direction markers. The selected strategy changes display cells only and never changes copy, search, canonical verse keys, resource joins, or reading history.

The regression set covers Al-Fatihah, Ayat al-Kursi, a sajdah verse, repeated diacritics, and the opening of Al-Alaq at widths around every layout breakpoint. It asserts code-point preservation in raw mode, stable word content in wrapped reverse modes, and semantic reader-position preservation during layout changes. Font-specific clipping still requires manual release checks in two terminals because OpenTUI and quran.sh cannot inspect a terminal emulator's glyph metrics.
