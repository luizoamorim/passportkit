# Marketing assets (`/services`)

Every visual on `/services` currently renders from CSS/SVG stand-ins so the page works
with no binary assets committed. Replace them here — no component changes needed unless
noted.

## Directory

```
public/marketing/
  box/            frame-0001.webp … frame-00NN.webp   (card 1: box opening)
  currency/       frame-0001.webp … frame-00NN.webp   (card 3: currency notes, optional)
  planet/         earth.webm | earth.mp4              (card 4: rotating Earth, optional)
  cards-fan.webp                                      (security section: fanned cards)
```

## 1. Box opening sequence (card 1)

Export 25–50 frames, ~1600px wide, WebP. Name them `frame-0001.webp` upward, then set
`frames` on the `starting-account` entry in `src/content/services-page-content.ts`:

```ts
frames: { dir: '/marketing/box', count: 40, ext: 'webp' },
```

`ScrollControlledMedia` takes over automatically: it paints to a single canvas, preloads
only the first four frames, and scrubs both directions with scroll. Frame 1 must be the
closed box and the last frame the fully open box with the card raised.

## 2. Fanned cards image (security section)

Drop a transparent PNG/WebP at `public/marketing/cards-fan.webp` (~1800px wide). Then in
`SecurityBenefitsSection.tsx` swap the `.fanPlaceholder` block for:

```tsx
<img src={SECURITY_SECTION.fanImage.src} alt={SECURITY_SECTION.fanImage.alt} width={1800} height={1125} />
```

Keep explicit `width`/`height` so no layout shift is introduced. The entry animation is on
the wrapper, so it keeps working unchanged.

## 3. Earth (card 4) and currency notes (card 3)

Both are optional upgrades — the CSS versions are already scroll-linked. For the Earth,
prefer a short WebM/MP4 and drive `currentTime` from the card's `progress` prop rather than
autoplaying, so it reverses on scroll-up like everything else.

## Rules

- WebP or AVIF for stills; WebM (VP9) with an MP4 fallback for video.
- Always reserve width/height.
- Do not ship more than ~50 frames; the mobile layout never loads the sequence.
