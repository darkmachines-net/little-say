# Little Say mountain

A warm, friendly mountain with a smaller foothill and a golden trail toward the summit. Inspired by Little Si and Mount Si in the Pacific Northwest, and the wordplay in Little Say. This is a character, not a literal topographic rendering.

The identity conveys a welcoming challenge and room to grow without a slogan or claims about a child's progress. Keep the face, rounded summit, forest greens, golden trail and smaller foothill together. Do not stretch it, tint it, turn it into a navigation control, or cover a family's cards with it.

## Files and usage

- `mountain-source.png`: selected transparent master generated with the built-in image generation tool, October 3, 2026.
- `mountain.png`, `mountain@2x.png`, `mountain@3x.png`: native/web UI sizes, loaded by `src/ui/Brand.tsx`.
- `app-icon.png`: 1024-square opaque icon; operating systems apply their own corner masks.
- `adaptive-foreground.png`: transparent padded Android foreground.
- `splash.png`: transparent native launch-screen artwork.
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.png`, `favicon.ico`: browser and installed web app assets.
- `colors.json`: shared UI, launch and web-install colors.

Run `npm run brand:assets` from the repository root to reproduce the size/padding variants with Expo's image utilities. The source artwork is preserved. Committed variants make normal builds independent of image generation. Native icon/splash changes require a new native build; Expo Go keeps its own launcher identity. The app's release fingerprint includes these native assets and the splash plugin, so distribute a new runtime before publishing these changes through OTA.
