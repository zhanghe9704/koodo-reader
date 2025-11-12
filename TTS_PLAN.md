# Koodo Reader TTS Development Plan

## 1. Survey Existing Capabilities
- Review the Dictation app to catalogue available English voices/models and understand how text is converted to speech (e.g., Piper CLI, local binaries).
- Audit the current Koodo Reader architecture (React front-end + Flask backend) to decide whether TTS generation runs server-side, client-side, or hybrid.
- Inventory reader data APIs (selection, page navigation, highlighting) to map how text context can be captured for TTS playback.

## 2. Backend Service Design
- Define REST endpoints for:
  - Listing available voices with metadata (name, gender, sample rate).
  - Generating audio from supplied text with parameters (voice, speed 0.5–2.0).
  - Managing playback sessions (start/stop/status) and returning sentence boundary metadata for highlighting.
- Reuse Dictation’s TTS pipeline for audio synthesis; encapsulate it so TTS requests from Koodo Reader invoke the same code path.
- Ensure endpoints can stream or chunk audio data so long passages can be played continuously, and send cues for page flips when the supplied text spans multiple sections.

## 3. Front-end Integration Strategy
- Extend the reader UI (top-right control bar or a new TTS panel) with:
  - Voice selector populated from the backend list.
  - Speed slider (0.5–2.0) and highlight toggle.
  - Start/Pause/Stop controls that reflect playback state.
- Hook into the rendition object to:
  - Detect selected text; if none, compute the top-of-page location.
  - Highlight the currently spoken sentence when highlighting is enabled.
  - Automatically trigger `rendition.next()` (and `handleLocation`) when playback crosses into the next page/section.
- Manage TTS state via Redux (voice, speed, highlight preference, playback status, active sentence) so components stay in sync.

## 4. Implementation Steps
1. **Backend**
   - Expose `/api/tts/voices` and `/api/tts/speak` routes, leveraging Dictation’s voice registry and synthesis engine.
   - Support optional parameters: `voiceId`, `speed`, `startCfi`, `endCfi`, and return `audioUrl` plus sentence offsets for highlighting.
2. **Front-end**
   - Add Redux slices/actions for TTS preferences and playback state.
   - Build a `TtsControl` component inside the reader header; fetch voice list on mount.
   - Implement logic to determine start text: use current selection via `rendition.getSelection()`; fallback to visible section start via `rendition.getPosition()`.
   - Stream audio via HTMLAudioElement or Web Audio API; listen for `ended` events to request the next chunk and flip pages.
   - Highlight sentences by mapping backend offsets to DOM ranges (using CFI data) and applying CSS classes.
3. **Bridging**
   - When playback requests more text (end of current section), fetch next section’s content, continue playback, and call `rendition.next()`.
   - Provide stop/pause handlers that cancel backend requests and clear highlights.

## 5. Testing & QA
- Unit/integration tests for backend TTS endpoints (voice listing, audio generation, speed adjustments).
- Manual testing across EPUB/PDF books to verify:
  - Start from selection vs. top-of-page.
  - Voice switching and speed control.
  - Sentence highlighting toggles correctly.
  - Automatic page turns occur without desync.
- Performance checks to ensure audio generation latency is acceptable; add graceful fallbacks if TTS backend is unavailable.
- Documentation updates (README/INSTALL) describing TTS usage and requirements.
