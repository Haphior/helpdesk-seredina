import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api';
import type { AppNotification } from '../lib/types';
import { BellIcon } from './icons';
import { formatDateTime } from '../lib/format';
import { useLiveEvents, useLiveStatus } from '../lib/live';

// Only a fallback now: while the live stream is connected, new notifications
// arrive as they happen (docs/adr/0053-live-updates.md).
const POLL_INTERVAL_MS = 20_000;

export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);

  function refreshCount() {
    apiGet<{ count: number }>('/notifications/unread-count')
      .then((res) => setUnreadCount(res.count))
      .catch(() => {});
  }

  const liveStatus = useLiveStatus();

  useEffect(() => {
    refreshCount();
    if (liveStatus === 'live') return;
    const interval = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [liveStatus]);

  function loadList() {
    apiGet<{ notifications: AppNotification[] }>('/notifications')
      .then((res) => setNotifications(res.notifications))
      .catch(() => {});
  }

  useLiveEvents((event) => {
    if (event.type !== 'notification.created' && event.type !== 'resync') return;
    refreshCount();
    if (open) loadList();
  });

  function toggleOpen() {
    setOpen((o) => {
      if (!o) loadList();
      return !o;
    });
  }

  async function markRead(id: string) {
    await apiPost(`/notifications/${id}/read`).catch(() => {});
    loadList();
    refreshCount();
  }

  async function markAllRead() {
    await apiPost('/notifications/read-all').catch(() => {});
    loadList();
    refreshCount();
  }

  return (
    <div className="relative">
      <button onClick={toggleOpen} aria-label={t('bell.title')} className="relative text-slate-400 hover:text-slate-700">
        <BellIcon width={18} height={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
              <span className="text-[13px] font-bold text-slate-700">{t('bell.title')}</span>
              <div className="flex items-center gap-2.5">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11.5px] font-medium text-indigo-600 hover:underline">
                    {t('bell.markAllRead')}
                  </button>
                )}
                <Link
                  to="/notification-settings"
                  onClick={() => setOpen(false)}
                  className="text-[11.5px] font-medium text-slate-400 hover:text-slate-600"
                >
                  {t('bell.settings')}
                </Link>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications === null && <p className="px-3.5 py-4 text-[12.5px] text-slate-400">{t('common.loading')}</p>}
              {notifications?.length === 0 && <p className="px-3.5 py-4 text-[12.5px] text-slate-400">{t('bell.empty')}</p>}
              {notifications?.map((n) => {
                const content = (
                  <div className={`px-3.5 py-2.5 text-[12.5px] ${n.readAt ? 'text-slate-500' : 'bg-indigo-50/60 text-slate-700'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span>{n.body}</span>
                      {!n.readAt && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                          className="flex-shrink-0 text-[11px] font-medium text-indigo-600 hover:underline"
                        >
                          {t('bell.markRead')}
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</div>
                  </div>
                );
                return n.ticket ? (
                  <Link
                    key={n.id}
                    to={`/tickets/${n.ticket.id}`}
                    onClick={() => {
                      setOpen(false);
                      if (!n.readAt) markRead(n.id);
                    }}
                    className="block border-b border-slate-50 hover:bg-slate-50"
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={n.id} className="border-b border-slate-50">
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
