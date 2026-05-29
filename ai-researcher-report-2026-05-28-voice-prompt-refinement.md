# AI Research Report — Voice Prompt Refinement

## Research Objective
Determine whether a free Google model on OpenRouter was available and suitable for refining browser speech-to-text output into a stronger AI CLI prompt, then implement the best-fit approach in the codebase.

## Methodology
- Reviewed the app structure and the existing voice input flow in:
  - `src/lib/services/voice-input.ts`
  - `src/lib/components/terminal/FloatingPromptBar.svelte`
  - `src/lib/components/workspace/FloatingNotepad.svelte`
  - `src/lib/components/workspace/NotesPanel.svelte`
  - `src/lib/components/workspace/TasksPanel.svelte`
  - `src/lib/components/shared/SettingsModal.svelte`
- Queried OpenRouter’s public models API to inspect available Google models and identify free options.
- Verified the OpenRouter chat completions endpoint requires an API key.
- Implemented the feature and validated it with `npm run check` and `npm run build`.

## Key Findings
- OpenRouter does have **free Google models**, but they are **Gemma** models, not Gemini.
- The available free Google models observed were:
  - `google/gemma-4-31b-it:free`
  - `google/gemma-4-26b-a4b-it:free`
- The paid Google Gemini family is available on OpenRouter, but those entries are not free.
- For prompt refinement, `google/gemma-4-31b-it:free` is the best default choice because it is the higher-quality free Google option.
- `google/gemma-4-26b-a4b-it:free` is a reasonable faster fallback.
- OpenRouter chat calls return `401 Unauthorized` without a key, so a user-provided API key is required.

## Implemented Build Plan
1. Add a unified voice refinement layer for all voice input surfaces.
2. Use local transcript cleanup first.
3. Send the cleaned transcript to OpenRouter using the free Google model.
4. Store voice refinement settings locally in the app.
5. Let the UI apply the refined result only after the voice session ends.
6. Fall back to local cleanup if the API key is missing or the network/model call fails.

## Production Recommendations
- Keep cloud refinement optional and clearly label that the API key is stored locally.
- Preserve technical terms, file paths, commands, and identifiers in the refinement prompt.
- Prefer low temperature and short completions for deterministic prompt cleanup.
- Consider migrating API key storage to a more secure secret store later if the app needs higher security guarantees.

## Data Sources
- OpenRouter models API: `https://openrouter.ai/api/v1/models`
- OpenRouter chat completions endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Codebase source files listed above

## Limitations
- Free model availability on OpenRouter can change over time.
- The OpenRouter API requires an API key, so end-to-end live testing of the refinement call was not possible without user credentials.
- The app currently stores the key locally in settings for convenience.

## Recommendations
1. Default to `google/gemma-4-31b-it:free`.
2. Keep `google/gemma-4-26b-a4b-it:free` as a fallback option.
3. Use the same refinement mode across voice inputs for consistency.
4. Preserve a local-only fallback so voice input still works without the cloud.
5. Add a small help note in settings so users understand the key is needed for cloud refinement.

## Validation Results
- `npm run check` — passed with existing warnings only.
- `npm run build` — completed successfully.
