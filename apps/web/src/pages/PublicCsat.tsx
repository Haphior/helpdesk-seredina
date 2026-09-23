import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { CsatSurvey } from '../lib/types';
import { PortalBrand } from '../components/PortalBrand';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StarIcon } from '../components/icons';

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={t('csat.rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t('csat.stars', { count: n })}
          onClick={() => onChange(n)}
          className="text-slate-300 transition-colors hover:text-amber-400"
        >
          <StarIcon width={32} height={32} fill={n <= value ? '#fbbf24' : 'none'} stroke={n <= value ? '#fbbf24' : 'currentColor'} />
        </button>
      ))}
    </div>
  );
}

export function PublicCsat() {
  const { t } = useTranslation();
  const { tenantSlug, token } = useParams<{ tenantSlug: string; token: string }>();
  const [survey, setSurvey] = useState<CsatSurvey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !token) return;
    apiGet<CsatSurvey>(`/public/${tenantSlug}/csat/${token}`)
      .then(setSurvey)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('csat.invalid')));
  }, [tenantSlug, token]);

  async function submit() {
    if (!tenantSlug || !token || rating === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await apiPost<CsatSurvey>(`/public/${tenantSlug}/csat/${token}`, { rating, comment: comment.trim() || undefined });
      setSurvey(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('csat.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-md">
        <PortalBrand tenantSlug={tenantSlug} title={t('csat.title')} />

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!survey && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

        {survey && (
          <Card className="!p-6">
            <p className="mb-1 text-[12.5px] text-slate-400">
              #{survey.ticketNumber} — {survey.ticketSubject}
            </p>

            {survey.respondedAt ? (
              <div className="py-4 text-center">
                <div className="mb-3 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <StarIcon key={n} width={28} height={28} fill={n <= (survey.rating ?? 0) ? '#fbbf24' : 'none'} stroke="#fbbf24" />
                  ))}
                </div>
                <p className="text-[14.5px] font-semibold text-slate-800">{t('csat.thanks')}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-2">
                <p className="text-[14.5px] font-semibold text-slate-800">{t('csat.rate')}</p>
                <StarPicker value={rating} onChange={setRating} />
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('csat.commentPlaceholder')}
                  rows={3}
                  className="w-full rounded-[9px] border border-slate-200 px-3 py-2 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
                <Button onClick={submit} disabled={rating === 0} isLoading={submitting} className="w-full justify-center">
                  {t('csat.submit')}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
