import type {FrameworkApiResponse} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';
import {startTransition, useEffect, useState} from 'react';

const statusToneClasses = {
  error: 'border-accent/15 bg-accent/15 text-accent',
  idle: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  loading: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  ready: 'border-success/20 bg-success/15 text-success',
} as const;

const surfaceToneClasses = {
  planned: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  ready: 'border-success/20 bg-success/15 text-success',
} as const;

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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-5 py-10 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/72 px-6 py-8 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:px-10 md:py-12">
        <div className="pointer-events-none absolute -top-3 -left-16 h-40 w-40 rounded-full bg-accent-soft/35 blur-3xl" />
        <div className="pointer-events-none absolute top-16 right-0 h-36 w-36 rounded-full bg-emerald-900/12 blur-3xl" />
        <div className="relative max-w-4xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-accent uppercase">
            Framework scaffold
          </p>
          <h1 className="mt-3 max-w-[12ch] font-serif text-5xl leading-[0.95] sm:text-6xl lg:text-[5.25rem]">
            {data.framework.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-ink-soft sm:text-lg">
            {data.framework.tagline}
          </p>
        </div>
        <div className="relative mt-8 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-3 py-2 text-[0.78rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[status]}`}
          >
            {status}
          </span>
          {errorMessage && (
            <span className="text-sm text-ink-soft">{errorMessage}</span>
          )}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-3xl">Runtime surfaces</h2>
          <p className="text-sm leading-6 text-ink-soft sm:text-base">
            These are the first framework seams now wired together.
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.framework.surfaces.map((surface) => (
            <article
              className="rounded-[1.4rem] border border-black/8 bg-white/74 p-5 shadow-[0_10px_24px_rgba(24,33,34,0.06)]"
              key={surface.id}
            >
              <div className="mb-5 flex justify-end">
                <span
                  className={`inline-flex rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${surfaceToneClasses[surface.state]}`}
                >
                  {surface.state}
                </span>
              </div>
              <h3 className="font-serif text-2xl leading-tight">
                {surface.name}
              </h3>
              <p className="mt-3 text-sm leading-6 text-ink-soft">
                {surface.summary}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-white/8 bg-ink-strong p-6 text-white shadow-[0_18px_42px_rgba(24,33,34,0.12)] md:p-7">
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-3xl">Provider posture</h2>
          <p className="max-w-3xl text-sm leading-6 text-white/74 sm:text-base">
            The app stays deterministic first and treats providers as optional.
          </p>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {data.providers.map((provider) => (
            <article
              className="rounded-[1.4rem] border border-white/10 bg-white/6 p-5"
              key={provider.id}
            >
              <h3 className="font-serif text-2xl">{provider.label}</h3>
              <p className="mt-3 text-sm leading-6 text-white/74">
                {provider.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-3xl">Immediate next steps</h2>
          <p className="text-sm leading-6 text-ink-soft sm:text-base">
            The scaffold is ready for the first real vertical slices.
          </p>
        </div>
        <ol className="mt-5 grid gap-3 pl-5 text-sm leading-6 text-ink-soft sm:text-base">
          {data.framework.priorities.map((priority) => (
            <li className="pl-1" key={priority}>
              {priority}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
