# Remotion opening comparison

This is a 10-second, 1080p comparison cut for the Hakka launch film. It uses
the existing local Geist fonts, failed-request capture, and real inspector
footage from `../assets/`. The 30-second film in `../delivery/` is unchanged.

```sh
cd media/launch/remotion
npm ci
npm run studio
npm run render
```

The render goes to ignored `renders/hakka-remotion-intro.mp4`. The reviewed
comparison copy and poster are in `delivery/`. Rendering requires Chrome and
uses no remote assets or audio.
