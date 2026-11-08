# Provider sign-in artwork

`ProviderSignInButton` bundles these assets so welcome branding does not depend on a network request. The button only presents the action; the existing Firebase provider adapter owns native authentication.

- `google-g.png`: Google's unmodified gradient G from [its branding assets](https://developers.google.com/static/identity/images/g-logo.png). Display at 20 logical units without tinting or stretching, on the white Google button.
- `google-sans-medium.ttf`: Google Sans Medium, downloaded from the [Google Fonts CSS API](https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&text=Sign%20in%20with%20Google) with the English button label as its character subset. Load through `expo-font` for this label only; update the subset if the label is localized. `OFL.txt` retains the font's license.
- `apple-sign-in.png`: Apple's supplied black, center-aligned **Sign in with Apple** button, generated at 240×50 logical points and scale 2 through [Apple's button endpoint](https://appleid.cdn-apple.com/appleid/button?type=sign-in&color=black&border=false&border_radius=0&width=240&height=50&scale=2&locale=en_US). Preserve its aspect ratio inside the black action; the surrounding control owns the accessible label and disabled/busy state.

Follow [Google's branding guidance](https://developers.google.com/identity/branding-guidelines) and [Apple's sign-in guidance](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple) when changing these treatments. Keep third-party marks separate from the [Little Say brand](../brand/README.md).
