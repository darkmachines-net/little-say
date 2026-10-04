# Little Say mountain

A warm, friendly mountain with a smaller foothill and a golden trail toward the summit. Inspired by the user's Pacific Northwest connection to Little Si and Mount Si, and the wordplay in Little Say. This is a character, not a literal topographic rendering.

The identity conveys a welcoming challenge and room to grow without a slogan or claims about a child's progress. Keep the face, rounded summit, forest greens, golden trail and smaller foothill together. Do not stretch it, tint it, turn it into a navigation control, or cover a family's cards with it.

## Files and usage

- `mountain-source.png`: selected transparent master generated with the built-in image generation tool, October 3, 2026. No separate API call or user API key was used.
- `mountain.png`, `mountain@2x.png`, `mountain@3x.png`: native/web UI sizes, loaded by `src/ui/Brand.tsx`.
- `app-icon.png`: 1024-square opaque icon; operating systems apply their own corner masks.
- `adaptive-foreground.png`: transparent padded Android foreground.
- `splash.png`: transparent native launch-screen artwork.
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.png`, `favicon.ico`: browser and installed web app assets.
- `colors.json`: shared UI, launch and web-install colors.

Run `npm run brand:assets` from the repository root to reproduce the size/padding variants with Expo's image utilities. The source artwork is preserved. Committed variants make normal builds independent of image generation. Native icon/splash changes require a new native build; Expo Go keeps its own launcher identity. The app's release fingerprint includes these native assets and the splash plugin, so distribute a new runtime before publishing these changes through OTA.

## Generation prompts

The built-in image tool generated a first version, then simplified it for legibility at small sizes. The second result is the selected master.

### Initial generation

```text
Use case: logo-brand.
Asset type: production mascot/logo mark for the Little Say toddler communication app, used at small sizes in a native app header and as an app icon.
Create one exceptionally polished, memorable, friendly cartoon mountain mascot on a genuinely transparent background. Inspired by the wooded, rocky foothills of Little Si and Mount Si in the Pacific Northwest: a broad, gently asymmetric rounded rocky summit, forest-green lower slopes, warm light sage rocky top, no alpine snow cap and no sharp intimidating peak. One small lower rounded foothill nestles against it, making the main mountain feel approachable to a small child. The main mountain has two small dark oval eyes and a simple kind curved smile; tiny soft peach cheeks are okay. A single broad, warm golden footpath curves gently from the bottom edge up one side toward the summit, suggesting a climb that is achievable one step at a time. Keep the face and path spatially separate and legible.
Style: contemporary children's picture-book character distilled into a premium app icon. Soft organic silhouette, clean confident shapes, rich muted pine and fresh sage greens, butter-yellow path, a little warm peach, deep evergreen facial details. Mostly flat color with very restrained soft shading; beautifully balanced, approachable, warm, natural, playful. Not a generic emoji or clip-art sticker. Subtle character, not a goofy exaggerated face.
Composition: square image, one cohesive compact freestanding mountain character centered and filling roughly 80% of the square, all edges fully inside the image. Strong silhouette and few large shapes readable even at 40 pixels. No enclosing badge, no border or white sticker outline, no cast shadow outside the silhouette. Actual transparent background throughout the space around the mark. No text, letters, speech bubbles, stars, flags, people, trees, sun, clouds, landscape scene or extra decorative elements. This must be a single usable brand mark, not a presentation sheet or app mockup.
```

### Final refinement

```text
Use case: precise-object-edit / logo-brand.
Edit the provided Little Say mountain mascot into its final small-size app logo.
Preserve its overall asymmetric rounded mountain silhouette, big kind dark eyes, smiling mouth, warm peach cheeks, small attached lower foothill on the left, and broad golden winding trail up the right. Preserve the lovely pine, sage, butter-yellow palette and the transparent background.
Make one focused improvement: radically simplify the tiny tree details and rock shading so this mark stays clear at 48 pixels. Replace the many individual triangular trees with just TWO broad smooth organic/scalloped forest-green color bands. Keep only two or three big rock planes at the summit. Eliminate fine grain, gradients, tiny texture, thin slivers and small detail. Use confident flat colors with beautifully smooth gently rounded edges, more like a premium children's picture-book logo cut from colored paper. The face should be a little larger and more central, with rounded small oval eyes (no white eye glints) and a simple smiling mouth, so the warm expression is readable when small.
A single compact freestanding mark, centered in a square with modest transparent padding. No text, badge, outline, shadow outside the silhouette, scene, tree symbols, extra objects or presentation layout. Output real transparency, not a white background.
```
