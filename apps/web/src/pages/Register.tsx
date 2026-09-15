import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout, Field } from '../components/AuthLayout';
import { ApiError } from '../lib/api';

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ tenantSlug, tenantName, adminEmail, adminName, password });
      navigate('/tickets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      tagline="Set up your workspace in under a minute."
      bullets={[
        'Your own tenant, isolated by row-level security',
        "Invite your team once you're in",
        'No credit card — self-hosted or cloud',
      ]}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">Create your organization</h1>
          <p className="text-[13.5px] text-slate-400">You'll be the first admin — invite teammates after.</p>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label="Organization slug" value={tenantSlug} onChange={setTenantSlug} placeholder="acme" />
          <Field label="Organization name" value={tenantName} onChange={setTenantName} placeholder="Acme Inc" />
          <Field label="Your name" value={adminName} onChange={setAdminName} />
          <Field label="Your email" type="email" value={adminEmail} onChange={setAdminEmail} />
          <Field label="Password" type="password" value={password} onChange={setPassword} />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create organization'}
        </button>

        <p className="text-center text-[13px] text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
