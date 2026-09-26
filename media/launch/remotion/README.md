# Remotion mobile comparison

This is a 12-second, portrait 1080×1920 comparison cut for the Hakka launch
film. It uses local Geist fonts and a real Hakka iOS demo recording from an
iPhone simulator in `../assets/mobile-ios-demo.mp4`. The final response hold
uses `../assets/mobile-ios-response.png` from the same run. The 30-second film
in `../delivery/` is unchanged.

```sh
cd media/launch/remotion
npm ci
npm run studio
npm run render
```

The render goes to ignored `renders/hakka-remotion-mobile.mp4`. The reviewed
comparison copy and poster are in `delivery/`. Rendering requires Chrome and
uses no remote assets or audio.

The four source clips preserve the real event order: the `/404` request fires
at 20.5–22.5 seconds, the native inspector opens at 59–61.5 seconds, its
request row is selected at 68–71.5 seconds, and the Response tab appears at
77.5–79.5 seconds. The held response screenshot is from the same simulator run.
