import { useEffect, useState } from 'react';
import Dashboard from './Dashboard.jsx';
import { request } from './api.js';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request('session')
      .then(() => setAuthenticated(true))
      .catch((error) => {
        if (error.status !== 401) setError(error.message);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('login', {
        username: fields.get('username'),
        password: fields.get('password'),
      });
      setAuthenticated(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="login-page" role="status">
        Conectando con Nova Salud…
      </div>
    );
  if (authenticated) return <Dashboard onSessionExpired={() => setAuthenticated(false)} />;
  return (
    <main className="login-page">
      <section className="panel login-card">
        <span className="brand-icon">✚</span>
        <p className="eyebrow">BOTICA NOVA SALUD</p>
        <h1>Bienvenido.</h1>
        <p className="muted">Ingresa para administrar el inventario y las ventas.</p>
        <form onSubmit={login} className="form-grid">
          <label>
            Usuario
            <input name="username" autoComplete="username" required maxLength={100} />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
      </section>
    </main>
  );
}
