'use client';

import { CURRENCY_CHIPS, PAYMENT_TILES, type ServiceCard } from '@/content/services-page-content';
import { ScrollControlledMedia } from '../ScrollControlledMedia';
import styles from '../marketing.module.css';

/** All cards receive a normalised 0..1 progress for the time they cross the viewport. */
type CardProps = { card: ServiceCard; progress: number };

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export function StartingAccountCard({ card, progress }: CardProps) {
  // Box opens as the card travels: flaps swing out, then the bank card lifts clear.
  const open = Math.min(1, progress / 0.75);
  const lift = Math.max(0, (progress - 0.35) / 0.65);

  return (
    <article className={styles.card}>
      <span className={styles.cardIcon} aria-hidden="true">◳</span>
      <h3 className={styles.cardTitle}>{card.title}</h3>
      <p className={styles.cardBody}>{card.body}</p>

      <div className={`${styles.media} ${styles.mediaBox}`}>
        {card.frames ? (
          <ScrollControlledMedia
            frames={card.frames}
            progress={progress}
            className={styles.boxScene}
            alt="A box opening to reveal a bank card"
          />
        ) : (
          // PLACEHOLDER: CSS/3D stand-in, fully scroll-driven and reversible.
          <div className={styles.boxScene} role="img" aria-label="A box opening to reveal a bank card">
            <div className={styles.boxBody}>
              <div
                className={`${styles.boxFlap} ${styles.boxFlapBack}`}
                style={{ transform: `rotateX(${lerp(0, -128, open)}deg)` }}
              />
              <div
                className={styles.boxCard}
                style={{ transform: `translate3d(0, ${lerp(30, -58, lift)}%, 0) rotate(${lerp(0, -7, lift)}deg)` }}
              />
              <div
                className={`${styles.boxFlap} ${styles.boxFlapFront}`}
                style={{ transform: `rotateX(${lerp(0, 122, open)}deg)` }}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export function GlobalPaymentsCard({ card, progress }: CardProps) {
  // Subtle parallax only — it must not compete with the main scroll.
  const shift = lerp(14, -14, progress);

  return (
    <article className={`${styles.card} ${styles.cardSplit}`}>
      <div>
        <span className={styles.cardIcon} aria-hidden="true">◈</span>
        <h3 className={styles.cardTitle}>{card.title}</h3>
        <p className={styles.cardBody}>{card.body}</p>
      </div>

      <div className={styles.tileGrid}>
        {PAYMENT_TILES.map((tile, index) => (
          <div
            key={tile}
            className={styles.tile}
            style={{ transform: `translate3d(0, ${shift * (index % 2 === 0 ? 1 : 0.55)}px, 0)` }}
          >
            {tile}
          </div>
        ))}
        <div className={`${styles.tile} ${styles.tileSwatch}`} style={{ transform: `translate3d(0, ${shift * 0.4}px, 0)` }} />
        <div className={`${styles.tile} ${styles.tileSwatch}`} style={{ transform: `translate3d(0, ${shift * 0.75}px, 0)` }} />
      </div>
    </article>
  );
}

export function CurrencyExchangeCard({ card, progress }: CardProps) {
  // Notes converge into a stack, then fan back out.
  const spread = Math.sin(Math.min(1, progress) * Math.PI);

  return (
    <article className={styles.card}>
      <span className={styles.cardIcon} aria-hidden="true">⇄</span>
      <h3 className={styles.cardTitle}>{card.title}</h3>

      <div className={`${styles.media} ${styles.mediaCurrency}`}>
        <div className={styles.noteFan} role="img" aria-label="Currency notes exchanging position">
          {CURRENCY_CHIPS.map((chip, index) => {
            const offset = index - (CURRENCY_CHIPS.length - 1) / 2;
            return (
              <span
                key={chip}
                className={styles.note}
                style={{
                  transform: `translate3d(${offset * spread * 62}%, ${Math.abs(offset) * spread * -14}%, 0) rotate(${offset * spread * 9}deg)`,
                  zIndex: 10 - Math.abs(offset),
                }}
              >
                {chip}
              </span>
            );
          })}
        </div>
        <span className={styles.exchangePill}>Exchange</span>
      </div>

      <p className={styles.cardBody}>{card.body}</p>
    </article>
  );
}

export function GlobalTransactionsCard({ card, progress }: CardProps) {
  return (
    <article className={`${styles.card} ${styles.cardDark}`}>
      <span className={`${styles.cardIcon} ${styles.cardIconGlobe}`} aria-hidden="true">◍</span>
      <h3 className={styles.cardTitle}>{card.title}</h3>

      <div className={`${styles.media} ${styles.mediaPlanet}`}>
        <span className={styles.stars} aria-hidden="true" />
        {/* PLACEHOLDER: swap for an Earth video/sequence; rotation stays scroll-linked. */}
        <span
          className={styles.planet}
          role="img"
          aria-label="The planet Earth seen from space"
          style={{ transform: `rotate(${lerp(-8, 8, progress)}deg)` }}
        >
          <span className={styles.planetLand} style={{ transform: `translateX(${lerp(6, -6, progress)}%)` }} aria-hidden="true" />
        </span>
      </div>

      <p className={styles.cardBody}>{card.body}</p>
    </article>
  );
}

export const CARD_RENDERERS: Record<string, (props: CardProps) => JSX.Element> = {
  'starting-account': StartingAccountCard,
  'global-payments': GlobalPaymentsCard,
  'currency-exchange': CurrencyExchangeCard,
  'global-transactions': GlobalTransactionsCard,
};
