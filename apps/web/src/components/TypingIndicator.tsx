import { useTranslation } from 'react-i18next';
import { useNow } from '../lib/sla';

/** How long "is typing…" stays up after the last ping -- a bit over twice the sender's ping interval. */
export const TYPING_VISIBLE_MS = 6_000;

/**
 * "Ana is typing…" (docs/adr/0056-sla-countdown.md). `lastSeen` maps user id
 * to when their last typing ping arrived; each one fades out on its own once
 * it's older than TYPING_VISIBLE_MS, on the page's shared clock.
 */
export function TypingIndicator({ lastSeen, nameOf }: { lastSeen: Record<string, number>; nameOf: (userId: string) => string }) {
  const { t } = useTranslation();
  const now = useNow();
  const typing = Object.entries(lastSeen)
    .filter(([, at]) => now - at < TYPING_VISIBLE_MS)
    .map(([userId]) => nameOf(userId));

  return (
    <div className="flex min-h-[20px] items-center gap-1.5 px-1 text-[12.5px] text-indigo-700" aria-live="polite">
      {typing.length > 0 && (
        <>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="h-1 w-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          {t('ticketDetail.typing', { names: typing.join(', '), count: typing.length })}
        </>
      )}
    </div>
  );
}
