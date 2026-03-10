import {startTransition, useEffect, useState} from 'react';
import type {FrameworkApiResponse} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';

const initialData: FrameworkApiResponse = {
  framework: createFrameworkSummary(),
  providers: listProviderDescriptors(),
};

export function App() {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadFramework() {
      setStatus('loading');

      try {
        const response = await fetch('/api/framework');

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const nextData = (await response.json()) as FrameworkApiResponse;

        startTransition(() => {
          setData(nextData);
          setStatus('ready');
          setErrorMessage('');
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown request error';

        startTransition(() => {
          setStatus('error');
          setErrorMessage(message);
        });
      }
    }

    void loadFramework();
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Framework scaffold</p>
        <h1>{data.framework.title}</h1>
        <p className="lede">{data.framework.tagline}</p>
        <div className="status-row">
          <span className={`status-pill status-${status}`}>{status}</span>
          {errorMessage && (
            <span className="status-detail">{errorMessage}</span>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Runtime surfaces</h2>
          <p>These are the first framework seams now wired together.</p>
        </div>
        <div className="card-grid">
          {data.framework.surfaces.map((surface) => (
            <article className="card" key={surface.id}>
              <div className="card-topline">
                <span className={`state-badge state-${surface.state}`}>
                  {surface.state}
                </span>
              </div>
              <h3>{surface.name}</h3>
              <p>{surface.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-contrast">
        <div className="panel-heading">
          <h2>Provider posture</h2>
          <p>
            The app stays deterministic first and treats providers as optional.
          </p>
        </div>
        <div className="provider-grid">
          {data.providers.map((provider) => (
            <article className="provider-card" key={provider.id}>
              <h3>{provider.label}</h3>
              <p>{provider.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Immediate next steps</h2>
          <p>The scaffold is ready for the first real vertical slices.</p>
        </div>
        <ol className="priority-list">
          {data.framework.priorities.map((priority) => (
            <li key={priority}>{priority}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
