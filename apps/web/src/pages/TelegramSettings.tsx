import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, ApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

interface TelegramChannelView {
  connected: boolean;
  botUsername: string | null;
}

export function TelegramSettings() {
  const [channel, setChannel] = useState<TelegramChannelView | null>(null);
  const [botToken, setBotToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    apiGet<TelegramChannelView>('/telegram-channel')
      .then(setChannel)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load Telegram settings'));
  }

  useEffect(load, []);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiPatch<TelegramChannelView>('/telegram-channel', { botToken });
      setChannel(updated);
      setBotToken('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect this bot');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect @${channel?.botUsername}? Existing Telegram tickets stay, but no new messages will come in until you reconnect.`)) return;
    setError(null);
    try {
      await apiDelete('/telegram-channel');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to disconnect');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Telegram</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        Connect a Telegram bot so a message to it becomes a ticket, and an agent's reply goes back
        as a real Telegram message. Create a bot with{' '}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-indigo-600 hover:underline"
        >
          @BotFather
        </a>{' '}
        and paste its token below.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {channel === null && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {channel?.connected ? (
        <Card className="max-w-md !p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-800">@{channel.botUsername}</p>
              <p className="text-[12.5px] text-emerald-600">Connected</p>
            </div>
            <Button variant="danger" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </Card>
      ) : (
        channel && (
          <form onSubmit={connect} className="flex max-w-md flex-col gap-4">
            <Input
              label="Bot token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:AAbecomesyourrealtokenherexxxxxxxxx"
            />
            <div>
              <Button type="submit" isLoading={saving} disabled={!botToken.trim()}>
                Connect
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
