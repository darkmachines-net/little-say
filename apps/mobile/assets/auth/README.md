# Provider sign-in artwork

`ProviderSignInButton` bundles these assets so welcome branding does not depend on a network request. The button only presents the action; the existing Firebase provider adapter owns native authentication.

- `google-g.png`: Google's unmodified gradient G from [its branding assets](https://developers.google.com/static/identity/images/g-logo.png). Display at 20 logical units without tinting or stretching, on the white Google button.
- `google-sans-medium.ttf`: Google Sans Medium, downloaded from the [Google Fonts CSS API](https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&text=Sign%20in%20with%20Google) with the English button label as its character subset. Load through `expo-font` for this label only; update the subset if the label is localized. `OFL.txt` retains the font's license.

Follow [Google's branding guidance](https://developers.google.com/identity/branding-guidelines) when changing these treatments. Keep third-party marks separate from the [Little Say brand](../brand/README.md).
