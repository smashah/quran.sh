# ADR 002: optional FFmpeg microphone capture behind `AudioCapture`

Status: accepted for an experimental, opt-in feature (2026-07-21)

quran.sh needs 16 kHz mono Float32 PCM for Tilawa, while OpenTUI 0.4.5 exposes playback but no microphone API. The application therefore owns a small `AudioCapture` interface. A deterministic WAV implementation is always available for tests and file transcription; live capture uses an already-installed FFmpeg sidecar and is activated only after the user explicitly starts listening.

FFmpeg is selected over an in-process native addon for this experimental release because it has macOS, Linux, and Windows capture backends, it can normalize channels/rate/sample format in one bounded pipe, and the child process can be terminated independently on cancellation. The trade-off is external installation and platform-specific device naming. `quran doctor` reports this capability; quran.sh never enumerates devices or requests permission at startup.

| Candidate | Bun/source | Standalone | Platform prebuilds | Permission/device loss | Packaging and maintenance |
|---|---|---|---|---|---|
| PortAudio/naudiodon-style native addon | Requires ABI-specific addon | Unproven without shipping native files | Coverage is inconsistent across current Bun targets | Rich device API when the addon works | Adds toolchains, native licenses, and one binary per target |
| Platform commands (`sox`, `arecord`, `ffmpeg`) | Process pipe works | Works when command is installed | macOS AVFoundation, Linux ALSA/Pulse, Windows dshow through FFmpeg | Permission denial and device loss appear as process exit/stderr | No bundled executable; user owns installation and device name |
| WAV/file source | Deterministic | Embedded | All targets | No microphone permission | Always available for tests and diagnosis, but it is not live capture |

The implemented FFmpeg prototype launches only after the second explicit `v` confirmation, requests `f32le`, 16 kHz, one channel, and 200 ms chunks, relies on pipe backpressure instead of an application PCM queue, and kills the child on stop or abort. The WAV prototype uses the same `AudioCapture` contract and verifies channel mixing, resampling, malformed input, cancellation, and repeated cleanup without hardware. macOS uses AVFoundation, Linux uses PulseAudio, and Windows uses dshow; CI proves the file contract on all three OS families, while live device names and permission prompts remain a documented host responsibility because hosted CI exposes no microphones.

The boundary is reversible. A maintained Bun-compatible capture library with prebuilds for every release target, reliable standalone behavior, device-loss events, and lower measured latency can replace the FFmpeg adapter without changing Tilawa or React code.
