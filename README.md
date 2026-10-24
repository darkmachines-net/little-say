# Expo SDK 58 browser evidence

Source: ed22781f7db99f6f679b27f5592de71d926d60df (mchartier/expo-sdk-58).

Both images show Chromium at 390 x 700 with simulated top/bottom safe-area insets of 48px and a one-second modal opening animation.

- account-before.png: SDK 58 before the AccountScreen web transition fix. The slide animation leaves stale safe-area padding and hides the account controls. Captured by the failing safe-area regression test.
- account-after.png: final source uses a fade on web, retaining the native slide. Account choices stay visible; Continue without an account was clicked successfully and opened language setup.

These are browser screenshots, not emulator, physical-device, or native-release evidence.