import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '../lib/api';
import { Button } from './Button';

// A hand-rolled spotlight instead of a tour library (react-joyride etc.) --
// this is a five-step highlight-and-tooltip, not a feature that justifies a
// new dependency and its own styling system to reconcile with this app's
// existing one. Steps with no `target` render as a centered card (welcome/done);
// steps with a `target` look up a `data-tour="<target>"` element live, so a
// step whose element isn't in the DOM (hidden by permission, or the tour got
// replayed from a page other than /dashboard) just falls back to centered
// instead of crashing or pointing at nothing.
interface TourStep {
  target?: string;
  titleKey: string;
  bodyKey: string;
}

const STEPS: TourStep[] = [
  { titleKey: 'tour.steps.welcome.title', bodyKey: 'tour.steps.welcome.body' },
  { target: 'nav-dashboard', titleKey: 'tour.steps.dashboard.title', bodyKey: 'tour.steps.dashboard.body' },
  { target: 'getting-started-widget', titleKey: 'tour.steps.checklist.title', bodyKey: 'tour.steps.checklist.body' },
  { target: 'nav-tickets', titleKey: 'tour.steps.tickets.title', bodyKey: 'tour.steps.tickets.body' },
  { target: 'nav-processes', titleKey: 'tour.steps.processes.title', bodyKey: 'tour.steps.processes.body' },
  { target: 'nav-knowledgeBase', titleKey: 'tour.steps.knowledgeBase.title', bodyKey: 'tour.steps.knowledgeBase.body' },
  { target: 'language-switcher', titleKey: 'tour.steps.language.title', bodyKey: 'tour.steps.language.body' },
  { titleKey: 'tour.steps.done.title', bodyKey: 'tour.steps.done.body' },
];

const CARD_WIDTH = 320;

export function GuidedTour({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[stepIndex];

  const measure = useCallback(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  async function finish() {
    onClose();
    try {
      await apiPost('/auth/complete-tour');
    } catch {
      // best-effort -- worst case the tour offers to run again next login too
    }
  }

  function next() {
    if (stepIndex === STEPS.length - 1) finish();
    else setStepIndex((i) => i + 1);
  }

  const cardStyle: CSSProperties = rect
    ? {
        position: 'fixed',
        top: Math.min(rect.bottom + 12, window.innerHeight - 240),
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - CARD_WIDTH - 16),
        width: CARD_WIDTH,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: CARD_WIDTH,
      };

  return (
    <>
      {rect && (
        <div
          className="pointer-events-none fixed z-[100] rounded-lg ring-2 ring-indigo-500 ring-offset-2 ring-offset-white"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="z-[101] rounded-xl border border-slate-200 bg-white p-4 shadow-xl" style={cardStyle}>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
          {t('tour.stepCount', { current: stepIndex + 1, total: STEPS.length })}
        </div>
        <h3 className="mb-1.5 text-[15px] font-bold text-slate-900">{t(step.titleKey)}</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-slate-600">{t(step.bodyKey)}</p>
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-[12.5px] font-medium text-slate-400 hover:text-slate-600">
            {t('tour.skip')}
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
                {t('tour.back')}
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {stepIndex === STEPS.length - 1 ? t('tour.finish') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
