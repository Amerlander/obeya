// Obeya's configuration, in a dialog over the page with its sections listed on the left: the
// canvases it serves and their repositories, edited and saved together (Obeya then starts again
// with them), and the settings saved on their own (models, voice, demos, language). The server's
// own settings come from its command line and show read-only.

import { type CSSProperties, Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, type AgentEffort, type AgentModel, type AgentRole, type AgentSetting, type AgentsView, blocksSaving, type CanvasConfig, type ConfigProblem, type ConfigView, type DemoSettings, type DemoSettingsView, type DemoVoiceCheck, type Language, type HostConfig, type LanguageView, type NarrationLanguage, type RepoConfig, type SetupCheck, type Theme, THEMES, type ThemeView, type VoiceKind, type VoiceSetupView } from '../core/types';
import { LANGUAGES } from '../core/locale';
import { pushKeyFromEvent, type PushKeyView } from '../core/push-key';
import { api, ApiError, reload } from './api';
import { keep } from './keep';
import { demoState, megabytes, PLATFORMS, SetupList, voiceState } from './setup';
import { errorText, pushKeyLabel, t } from './strings';
import { applyTheme } from './theme';

declare global {
  interface Window {
    /** Set by the app (app/src/main.rs) in its window; absent in a browser. */
    obeyaApp?: { version: string; platform: string };
  }
}

type Checked = Pick<ConfigView, 'resolved' | 'problems'>;

/** Hands the Koordinator a request; to the one of `canvas` where given, else to this page's. */
type Ask = (text: string, canvas?: string) => void;

/** The dialog's sections, in the order its list shows them. */
type Section = 'canvases' | 'agents' | 'voice' | 'demos' | 'general';
const SECTIONS: Section[] = ['canvases', 'agents', 'voice', 'demos', 'general'];
// the section shown, per tab: a save restarts Obeya and a new language reloads the page, and the dialog comes back at it
const SECTION_KEY = 'obeya-config-section';

/** Opens the dialog at the canvases and their repositories next time, as from the note on a plan directory. */
export const showCanvasesSection = () => sessionStorage.setItem(SECTION_KEY, 'canvases');

export function ConfigDialog({ on, onClose, onSetup, onAsk, onTalk, onProblems }: { on: boolean; onClose: () => void; onSetup: () => void; onAsk: Ask; onTalk: () => void; onProblems: (n: number) => void }) {
  const [view, setView] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<CanvasConfig[]>([]);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState(false);
  const [section, setSectionState] = useState<Section>(() => {
    const s = sessionStorage.getItem(SECTION_KEY) as Section | null;
    return s && SECTIONS.includes(s) ? s : 'canvases';
  });
  const setSection = (s: Section) => {
    sessionStorage.setItem(SECTION_KEY, s);
    setSectionState(s);
  };
  // the id each canvas of the draft had when loaded: renaming a running canvas keeps it, and its cards
  const [origin, setOrigin] = useState<(string | null)[]>([]);
  const load = (v: ConfigView) => {
    setDraft(v.canvases);
    setOrigin(v.resolved.map((r) => r?.id ?? null));
  };

  const changed = !!view && JSON.stringify(draft) !== JSON.stringify(view.canvases);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  // read afresh whenever the dialog opens: the Koordinator or the file may have changed it; a draft not saved yet stays
  useEffect(() => {
    if (!on) return;
    const s = sessionStorage.getItem(SECTION_KEY) as Section | null;
    if (s && SECTIONS.includes(s)) setSectionState(s);
    api.config().then((v) => {
      setView(v);
      if (!changedRef.current) load(v);
      setChecked(v);
      onProblems(v.problems.length);
      setStatus(v.restarting ? t.config.saved : '');
    }, console.error);
  }, [on]);

  // the draft is checked as it is edited: paths, adapters, ids
  const seq = useRef(0);
  useEffect(() => {
    if (!view || !changed) return void (view && setChecked(view));
    const n = ++seq.current;
    const h = setTimeout(() => api.checkConfig(draft).then((c) => n === seq.current && setChecked(c), console.error), 300);
    return () => clearTimeout(h);
  }, [draft, view]);

  const problems = checked?.problems ?? [];
  const c = t.config;
  return (
    // a press on the dim around the dialog closes it; a press that starts inside does not
    <div id="config" className={on ? 'on' : undefined} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cfg-box" role="dialog" aria-modal="true" aria-label={c.title}>
        <nav className="cfg-nav">
          <div className="p-kind">{c.kind}</div>
          <h2>{c.title}</h2>
          <div className="cfg-ask">
            <p className="hint">{c.koordinator}</p>
            <button className="btn small" onClick={onTalk}>
              {c.askObeya}
            </button>
          </div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s}>
                <button className={s === section ? 'on' : undefined} aria-current={s === section || undefined} onClick={() => setSection(s)}>
                  {c.sections[s]}
                  {s === 'canvases' && changed && <span className="cfg-dot" title={c.unsaved} />}
                  {s === 'canvases' && problems.length > 0 && (
                    <span className="n err" title={c.problemCount(problems.length)}>
                      {problems.length}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="cfg-nav-foot">
            <button className="btn small" onClick={onSetup}>
              {t.setup.check}
            </button>
          </div>
        </nav>
        <div className="cfg-main">
          <button className="cfg-close" title={t.close} onClick={onClose}>
            ✕
          </button>
          <section className="cfg-sec" hidden={section !== 'canvases'}>
            {!view ? (
              <>
                <Head title={c.sections.canvases} />
                <p className="hint">{c.loading}</p>
              </>
            ) : (
              <Canvases
                view={view}
                draft={draft}
                origin={origin}
                checked={checked}
                changed={changed}
                busy={busy}
                onAsk={onAsk}
                onDraft={(d, o) => {
                  setDraft(d);
                  setOrigin(o);
                }}
                onSave={async () => {
                  setBusy(true);
                  try {
                    const { restarting } = await api.saveConfig(draft);
                    setView({ ...view, canvases: draft, restarting });
                    setStatus(restarting ? c.saved : c.savedOnly);
                  } catch (e) {
                    setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
                  }
                  setBusy(false);
                }}
                onReset={() => load(view)}
                status={status}
                json={json}
                onJson={() => setJson(!json)}
              />
            )}
          </section>
          <section className="cfg-sec" hidden={section !== 'agents'}>
            <AgentsBlock on={on} />
          </section>
          <section className="cfg-sec" hidden={section !== 'voice'}>
            <VoiceBlock on={on} />
            <PushKeyBlock on={on} />
          </section>
          <section className="cfg-sec" hidden={section !== 'demos'}>
            <DemoBlock on={on} />
          </section>
          <section className="cfg-sec" hidden={section !== 'general'}>
            <Head title={c.sections.general} />
            <LanguageBlock on={on} />
            <ThemeBlock on={on} />
            {view && <ServerBlock server={view.server} />}
          </section>
        </div>
      </div>
    </div>
  );
}

/** A section's title, what it is about, and the file it is saved in; `sub` for a part of a section. */
function Head({ title, hint, file, sub }: { title: string; hint?: ReactNode; file?: string; sub?: boolean }) {
  return (
    <header className={sub ? 'cfg-head sub' : 'cfg-head'}>
      {sub ? <h4>{title}</h4> : <h3>{title}</h3>}
      {hint && <p className="hint">{hint}</p>}
      {file && (
        <p className="hint cfg-file">
          {t.config.fromFile} <code>{file}</code>
        </p>
      )}
    </header>
  );
}

/** One setting: what it is on the left, the control with what to know about it on the right. */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="cfg-field">
      <div className="cfg-label">{label}</div>
      <div className="cfg-control">
        {children}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * What to know about a field, behind a small icon: the icon shows while the pointer is on the field or its
 * label (the nearest `.cfg-has-info` around it) or the field has the focus, so the page stays calm; the text
 * shows on the icon at once, kept inside the window.
 */
function Info({ text }: { text: string }) {
  const id = useId();
  const icon = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const show = () => {
    const r = icon.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - 12, innerWidth - TIP_WIDTH - 8));
    // below the icon, or above it in the lower part of the window
    setAt(r.bottom > innerHeight * 0.65 ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    addEventListener('scroll', hide, true);
    return () => removeEventListener('scroll', hide, true);
  }, [at]);
  return (
    <>
      <button
        type="button"
        ref={icon}
        className={at ? 'cfg-info on' : 'cfg-info'}
        aria-label={t.config.info}
        aria-describedby={id}
        onPointerEnter={show}
        onPointerLeave={() => setAt(null)}
        onFocus={show}
        onBlur={() => setAt(null)}
        onClick={(e) => (e.preventDefault(), show())}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="5" r=".95" fill="currentColor" />
          <path d="M8 7.3v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <span id={id} className="cfg-tip" role="tooltip" hidden={!at} style={at ?? undefined}>
        {text}
      </span>
    </>
  );
}

const TIP_WIDTH = 340;

interface CanvasesProps {
  view: ConfigView;
  draft: CanvasConfig[];
  origin: (string | null)[];
  checked: Checked | null;
  changed: boolean;
  busy: boolean;
  onAsk: Ask;
  onDraft: (draft: CanvasConfig[], origin: (string | null)[]) => void;
  onSave: () => void;
  onReset: () => void;
  status: string;
  json: boolean;
  onJson: () => void;
}

/** The canvases with their repositories, saved together; Obeya then starts again with them. */
function Canvases({ view, draft, origin, checked, changed, busy, onAsk, onDraft, onSave, onReset, status, json, onJson }: CanvasesProps) {
  const c = t.config;
  const problems = checked?.problems ?? [];
  const setCanvas = (i: number, x: CanvasConfig | null) =>
    x
      ? onDraft(
          draft.map((y, j) => (j === i ? x : y)),
          origin,
        )
      : onDraft(
          draft.filter((_, j) => j !== i),
          origin.filter((_, j) => j !== i),
        );
  // a canvas with a problem has no id yet: which running canvas goes is only known once all resolve
  const resolved = checked?.resolved ?? [];
  const gone = resolved.every(Boolean) ? view.running.filter((id) => !resolved.some((r) => r?.id === id)) : [];
  return (
    <>
      <Head
        title={c.sections.canvases}
        hint={
          view.source === 'file' ? (
            <>
              {c.fromFile} <code>{view.file}</code>
            </>
          ) : (
            c.fromArgs(view.file)
          )
        }
      />
      {draft.map((x, i) => (
        <CanvasBlock
          key={i}
          n={i}
          canvas={x}
          resolved={checked?.resolved[i] ?? null}
          running={view.running}
          pin={origin[i] && view.running.includes(origin[i]) ? origin[i] : undefined}
          saved={!changed}
          adapters={view.adapters}
          problems={problems.filter((p) => p.canvas === i)}
          ask={changed ? undefined : onAsk}
          onChange={(y) => setCanvas(i, y)}
        />
      ))}
      <button className="btn small" onClick={() => onDraft([...draft, { repos: [{ path: '' }] }], [...origin, null])}>
        {c.addCanvas}
      </button>
      {problems
        .filter((p) => p.canvas === undefined)
        .map((p, k) => (
          <Problem key={k} problem={p} where="" ask={changed ? undefined : onAsk} />
        ))}
      {changed && gone.length > 0 && <p className="hint warn">{c.gone(gone.join(', '))}</p>}
      {json && <pre className="c-json">{JSON.stringify(draft, null, 2)}</pre>}
      <div className="cfg-actions">
        <button className="btn primary" disabled={!changed || busy || problems.some(blocksSaving)} onClick={onSave}>
          {view.server.restarts ? c.save : c.saveOnly}
        </button>
        {changed && (
          <button className="btn" disabled={busy} onClick={onReset}>
            {c.reset}
          </button>
        )}
        {status && <span className="hint c-status">{status}</span>}
        <button className={json ? 'btn small cfg-json on' : 'btn small cfg-json'} onClick={onJson}>
          {c.json}
        </button>
      </div>
    </>
  );
}

/** The server's own settings, from its command line: shown, not changed here. */
function ServerBlock({ server }: { server: ConfigView['server'] }) {
  const c = t.config;
  return (
    <>
      <Head sub title={c.server} />
      <Field label={c.version}>
        {server.version}
        {server.commit && <> · {c.checkout(server.commit.slice(0, 7))}</>}
      </Field>
      <Field label={c.port}>{server.port}</Field>
      <Field label={c.dataDir}>
        <code>{server.home}</code>
      </Field>
      <Field label={c.permissionMode}>
        <code>{server.permissionMode}</code>
      </Field>
      <Field label={c.restarts}>{!server.restarts ? c.no : server.commit ? c.yes : c.noCheckout}</Field>
      {/* in the app's window (app/src/main.rs), which opens a new window in the default browser */}
      {window.obeyaApp && (
        <button className="btn small" title={c.openInBrowserHint} onClick={() => window.open(location.href, '_blank')}>
          {c.openInBrowser}
        </button>
      )}
    </>
  );
}

/** Voices grouped as the settings sheet offers them; `say` only on a Mac. */
const VOICE_GROUPS: { group: 'local' | 'service' | 'own'; voices: VoiceKind[] }[] = [
  { group: 'local', voices: ['piper', 'qwen3', 'say'] },
  { group: 'service', voices: ['gemini', 'openai', 'elevenlabs', 'azure'] },
  { group: 'own', voices: ['command', 'http'] },
];
/** The fields each voice reads, in the order the sheet shows them. */
const VOICE_FIELDS: Record<VoiceKind, ('voiceName' | 'reference' | 'command' | 'url' | 'keyFile')[]> = {
  piper: ['voiceName'],
  qwen3: ['voiceName', 'reference'],
  say: ['voiceName'],
  command: ['command'],
  http: ['url', 'keyFile'],
  gemini: ['voiceName', 'keyFile'],
  openai: ['voiceName', 'url', 'keyFile'],
  elevenlabs: ['voiceName', 'keyFile'],
  azure: ['url', 'voiceName', 'keyFile'],
};
/** A stock voice of a model or service is nobody's own. */
const STOCK_ONLY: VoiceKind[] = ['piper', 'say'];

/** The language Obeya speaks to the owner: saved on its own, and the page loads again in it. */
function LanguageBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<LanguageView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (on) api.language().then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.config.language;
  const choose = async (language: Language | null) => {
    setBusy(true);
    setStatus('');
    try {
      const v = await api.saveLanguage(language);
      setView(v);
      // the strings are set before the first render: the page loads again, keeping what is open
      reload();
    } catch (e) {
      setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
      setBusy(false);
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <select aria-label={l.title} value={view.chosen ?? ''} disabled={busy} onChange={(e) => choose((e.target.value || null) as Language | null)}>
          <option value="">{l.system(l.names[view.system])}</option>
          {LANGUAGES.map((x) => (
            <option key={x} value={x}>
              {l.names[x]}
            </option>
          ))}
        </select>
      </Field>
      {status && <p className="hint c-status">{status}</p>}
    </>
  );
}

/** Light or dark, or as the system: saved on its own, and the page takes it at once. */
function ThemeBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<ThemeView | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) api.theme().then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.config.theme;
  const choose = async (theme: Theme | null) => {
    const before = view;
    setView({ ...view, chosen: theme });
    applyTheme(theme);
    setStatus('');
    try {
      setView(await api.saveTheme(theme));
    } catch (e) {
      setView(before);
      applyTheme(before.chosen);
      setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <div className="seg" role="radiogroup" aria-label={l.title}>
          {[null, ...THEMES].map((x) => (
            <button key={x ?? 'system'} type="button" role="radio" aria-checked={view.chosen === x} className={view.chosen === x ? 'on' : undefined} onClick={() => choose(x)}>
              {x ? l.names[x] : l.system}
            </button>
          ))}
        </div>
      </Field>
      {status && <p className="hint c-status">{status}</p>}
    </>
  );
}

/**
 * The push-to-talk key in another app, heard by the app's shell: what it hears, and the key, chosen
 * by pressing it. A modifier alone counts once it is let go without another key; with another key it
 * starts a combination.
 */
function PushKeyBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<PushKeyView | null>(null);
  const [status, setStatus] = useState('');
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!on) return;
    const load = () => api.pushKey().then(setView, console.error);
    void load();
    // the shell reports every two seconds: what it hears shows here as it changes (an allowed permission, say)
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [on]);
  const save = async (key: string | null) => {
    setStatus('');
    try {
      setView(await api.savePushKey(key));
    } catch (e) {
      setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
    }
  };
  useEffect(() => {
    if (!listening) return;
    let modifier: string | null = null;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setListening(false);
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code)) {
        modifier = e.code;
        return;
      }
      modifier = null;
      const key = pushKeyFromEvent(e);
      setListening(false);
      if (key) void save(key);
      else setStatus(t.config.pushKey.notAKey);
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== modifier) return;
      setListening(false);
      void save(modifier);
    };
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    return () => {
      removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
    };
  }, [listening]);
  if (!view) return null;
  const p = t.config.pushKey;
  const shell = view.shell;
  const state = !shell
    ? p.appOnly
    : shell.state === 'on'
      ? shell.detail
        ? p.bound(shell.detail)
        : p.on(pushKeyLabel(view.key))
      : shell.state === 'permission' && shell.detail === 'restart'
        ? p.states.restart
        : shell.state === 'error'
          ? `${p.states.error}: ${shell.detail ?? ''}`
          : p.states[shell.state];
  return (
    <div className={`c-push-key${listening ? ' listening' : ''}`}>
      <Head sub title={p.title} hint={p.hint} />
      <Field
        label={p.key}
        hint={
          <span className={shell && shell.state !== 'on' ? 'warn' : undefined}>
            {listening ? p.pressHint : state}{' '}
            {!listening && shell?.state === 'permission' && shell.detail !== 'restart' && (
              <button className="btn small" onClick={() => window.open(INPUT_MONITORING, '_blank')}>
                {p.openSettings}
              </button>
            )}
          </span>
        }
      >
        <span className="cfg-inline">
          <kbd>{listening ? p.press : pushKeyLabel(view.key)}</kbd>
          <button className="btn small" disabled={listening} onClick={() => (setStatus(''), setListening(true))}>
            {p.change}
          </button>
          {view.chosen && (
            <button className="btn small" onClick={() => save(null)}>
              {p.reset(pushKeyLabel(view.default))}
            </button>
          )}
        </span>
      </Field>
      {status && <p className="hint c-status">{status}</p>}
    </div>
  );
}

/** The macOS settings page where the app gets "Input Monitoring" (as src/server/push-key.ts). */
const INPUT_MONITORING = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';

/** The model and effort of each group of agents: saved on each change, taken by the next agent that starts. */
function AgentsBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<AgentsView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (on) api.agents().then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const a = t.config.agents;
  const choose = async (role: AgentRole, choice: Partial<AgentSetting>) => {
    setBusy(true);
    setStatus('');
    try {
      setView(await api.saveAgents(role, choice));
    } catch (e) {
      setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
    }
    setBusy(false);
  };
  return (
    <>
      <Head title={a.title} hint={a.hint} file={view.file} />
      <div className="cfg-agents">
        <span />
        <span className="hint">{a.model}</span>
        <span className="hint">{a.effort}</span>
        {AGENT_ROLES.map((role) => {
          const setting = view.agents[role];
          return (
            <Fragment key={role}>
              <div className="cfg-agent">
                {a.roles[role].name}
                <span className="hint">{a.roles[role].hint}</span>
              </div>
              <select aria-label={`${a.roles[role].name}: ${a.model}`} value={setting.model} disabled={busy} onChange={(e) => choose(role, { model: e.target.value as AgentModel })}>
                {AGENT_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {a.models[m]}
                  </option>
                ))}
              </select>
              <select aria-label={`${a.roles[role].name}: ${a.effort}`} value={setting.effort} disabled={busy} onChange={(e) => choose(role, { effort: e.target.value as AgentEffort })}>
                {AGENT_EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    {a.efforts[x]}
                  </option>
                ))}
              </select>
            </Fragment>
          );
        })}
      </div>
      {status && <p className="hint c-status">{status}</p>}
    </>
  );
}

/** How demos are narrated: saved on their own, read by the next render, so nothing restarts. */
function DemoBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<DemoSettingsView | null>(null);
  const [draft, setDraft] = useState<DemoSettings | null>(null);
  const [check, setCheck] = useState<DemoVoiceCheck | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!on) return;
    api.demoSettings().then((v) => {
      setView(v);
      setDraft(v.settings);
      setStatus('');
    }, console.error);
  }, [on]);
  const installing = !!view?.job?.running;
  // the voice as it is being chosen: its problems, what it still needs installed
  useEffect(() => {
    if (!draft) return;
    let live = true;
    api.checkDemoVoice(draft).then((c) => live && setCheck(c), console.error);
    return () => {
      live = false;
    };
  }, [draft, installing]);
  // an installation runs on the server: follow it until it ends
  useEffect(() => {
    if (!on || !installing) return;
    const timer = setInterval(() => api.demoSettings().then(setView, console.error), 1500);
    return () => clearInterval(timer);
  }, [on, installing]);
  useEffect(() => () => audio.current?.pause(), []);
  if (!view || !draft) return null;
  const d = t.config.demo;
  const changed = JSON.stringify(draft) !== JSON.stringify(view.settings);
  const set = <K extends keyof DemoSettings>(k: K, v: DemoSettings[K]) => setDraft({ ...draft, [k]: v });
  const shown = check ?? view.check;
  const job = view.job?.voice === draft.voice ? view.job : undefined;
  const failed = (e: unknown) => setStatus(e instanceof ApiError ? errorText(e.code) + (e.code === 'voiceSample' ? ` ${e.message}` : '') : t.offlineError);
  const save = async () => {
    setBusy(true);
    try {
      const v = await api.saveDemoSettings(draft);
      setView(v);
      setDraft(v.settings);
      setStatus(d.saved);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const install = async () => {
    setStatus('');
    try {
      setView(await api.installDemoVoice(draft));
    } catch (e) {
      failed(e);
    }
  };
  const listen = async () => {
    setSampling(true);
    setStatus('');
    try {
      const wav = await api.demoVoiceSample(draft);
      audio.current?.pause();
      audio.current = new Audio(URL.createObjectURL(wav));
      await audio.current.play();
    } catch (e) {
      failed(e);
    }
    setSampling(false);
  };
  const field = (k: (typeof VOICE_FIELDS)[VoiceKind][number]) => (
    <Field key={k} label={d.field[k](draft.voice)}>
      <input
        className="c-path"
        aria-label={d.field[k](draft.voice)}
        spellCheck={false}
        placeholder={d.placeholder[k](draft.voice)}
        value={draft[k] ?? ''}
        onChange={(e) => set(k, e.target.value || undefined)}
      />
    </Field>
  );
  return (
    <>
      <Head title={d.title} hint={d.hint} file={view.file} />
      <div className="cfg-cols">
        <div>
          <Field label={d.language}>
            <select aria-label={d.language} value={draft.language} onChange={(e) => set('language', e.target.value as NarrationLanguage)}>
              {(Object.keys(d.languages) as NarrationLanguage[]).map((l) => (
                <option key={l} value={l}>
                  {d.languages[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={d.voice} hint={d.about[draft.voice]}>
            <select
              aria-label={d.voice}
              value={draft.voice}
              // another voice starts with its own fields, and is nobody's own until ticked
              onChange={(e) => setDraft({ language: draft.language, voice: e.target.value as VoiceKind, listenBack: draft.listenBack })}
            >
              {VOICE_GROUPS.map(({ group, voices }) => (
                <optgroup key={group} label={d.groups[group]}>
                  {voices
                    .filter((v) => v !== 'say' || view.platform === 'darwin' || draft.voice === 'say')
                    .map((v) => (
                      <option key={v} value={v}>
                        {d.voices[v]}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {VOICE_FIELDS[draft.voice].map(field)}
          <Field label="" hint={d.person[shown.person]}>
            {!STOCK_ONLY.includes(draft.voice) && (
              <label className="c-check">
                <input type="checkbox" checked={!!draft.ownVoice} onChange={(e) => set('ownVoice', e.target.checked || undefined)} />
                {d.ownVoice}
              </label>
            )}
          </Field>
          <Field label="">
            {job?.running ? (
              <p className="hint c-install">
                <span className="c-step">{d.installing}</span> <code>{job.line}</code>
              </p>
            ) : (
              !shown.install.installed && (
                <div className="c-install">
                  <p className="hint">{d.notInstalled(shown.install.missing.join(', '), megabytes(shown.install.mb))}</p>
                  <button className="btn small" disabled={installing} onClick={install}>
                    {d.install(megabytes(shown.install.mb))}
                  </button>
                </div>
              )
            )}
            {job?.error && !job.running && <p className="p-error">{d.installFailed(job.error.split('\n').at(-1) ?? '')}</p>}
            {shown.problems.map((p) => (
              <p key={p} className="p-error">
                {d.problem[p]}
              </p>
            ))}
            <button className="btn small" disabled={sampling || !shown.install.installed || !!shown.problems.length} onClick={listen}>
              {sampling ? d.sampling : d.listen}
            </button>
            <label className="c-check">
              <input type="checkbox" checked={draft.listenBack !== false} onChange={(e) => set('listenBack', e.target.checked ? undefined : false)} />
              {d.listenBack}
            </label>
          </Field>
          <div className="cfg-actions">
            <button className="btn primary" disabled={!changed || busy} onClick={save}>
              {d.save}
            </button>
            {changed && (
              <button className="btn" disabled={busy} onClick={() => setDraft(view.settings)}>
                {t.config.reset}
              </button>
            )}
            {status && <span className="hint c-status">{status}</span>}
          </div>
        </div>
        <SetupBlock draft={draft} installing={installing} />
      </div>
    </>
  );
}

/**
 * What a render needs on this machine besides the voice (that has its own lines above), each
 * missing piece with how to install it here. Checked again for the voice's listening back as it
 * is being chosen, after an installation, and on request.
 */
function SetupBlock({ draft, installing }: { draft: DemoSettings; installing: boolean }) {
  const [setup, setSetup] = useState<SetupCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const s = t.config.setup;
  const recheck = () => {
    setChecking(true);
    return api
      .demoSetup(draft)
      .then(setSetup, console.error)
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    if (!installing) recheck();
  }, [draft.listenBack, installing]);
  if (!setup) return null;
  const items = setup.items.filter((i) => i.id !== 'voice');
  return (
    <div className="c-setup">
      <Head sub title={s.title} hint={s.hint(`${PLATFORMS[setup.platform] ?? setup.platform} (${setup.arch})`)} />
      <SetupList items={items} name={(i) => s.names[i.id]} state={demoState} />
      {!items.some((i) => i.state === 'missing') && <p className="hint">{s.ready}</p>}
      <p className="hint">
        {s.guide} <code>docs/demo-setup.md</code>
      </p>
      <button className="btn small" disabled={checking} onClick={recheck}>
        {checking ? s.checking : s.recheck}
      </button>
    </div>
  );
}

/**
 * What the owner's voice input needs on this machine, with one button that loads Whisper
 * (fetching it the first time). Follows an installation until it ends.
 */
function VoiceBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<VoiceSetupView | null>(null);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const recheck = () => {
    setChecking(true);
    return api
      .voiceSetup()
      .then(setView, console.error)
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    if (on) recheck();
  }, [on]);
  const running = !!view?.job?.running;
  useEffect(() => {
    if (!on || !running) return;
    const timer = setInterval(() => api.voiceSetup().then(setView, console.error), 1500);
    return () => clearInterval(timer);
  }, [on, running]);
  if (!view) return null;
  const v = t.config.voice;
  const s = t.config.setup;
  const install = async () => {
    setStatus('');
    try {
      setView(await api.installVoice());
    } catch (e) {
      setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
    }
  };
  const blocked = view.items.some((i) => i.state === 'missing');
  return (
    <div className="c-setup">
      <Head title={v.title} hint={v.hint(`${PLATFORMS[view.platform] ?? view.platform} (${view.arch})`)} />
      <SetupList items={view.items} name={(i) => v.names[i.id]} state={voiceState} />
      {view.listen === 'faster' && <p className="hint">{v.faster}</p>}
      {view.job?.running ? (
        <p className="hint c-install">
          <span className="c-step">{v.step[view.job.step]}</span> <code>{view.job.line}</code>
        </p>
      ) : view.fetch.parts.length ? (
        <div className="c-install">
          <button className="btn small" disabled={blocked} onClick={install}>
            {v.install(megabytes(view.fetch.mb))}
          </button>
        </div>
      ) : (
        !view.items.some((i) => i.state === 'missing') && <p className="hint">{v.ready}</p>
      )}
      {view.job?.error && !view.job.running && <p className="p-error">{v.failed(view.job.error.split('\n').at(-1) ?? '')}</p>}
      {status && <p className="hint c-status">{status}</p>}
      <button className="btn small" disabled={checking || running} onClick={recheck}>
        {checking ? s.checking : s.recheck}
      </button>
    </div>
  );
}

interface CanvasProps {
  n: number;
  canvas: CanvasConfig;
  resolved: ConfigView['resolved'][number];
  running: string[];
  /** The id of the running canvas this one is: a new name keeps it. */
  pin?: string;
  /** The configuration shown is the one saved: a running canvas is the one shown. */
  saved: boolean;
  adapters: string[];
  problems: ConfigProblem[];
  /** Has the Koordinator create a task that fixes a problem; only for the configuration as saved, which is what it reads. */
  ask?: Ask;
  onChange: (c: CanvasConfig | null) => void;
}

function CanvasBlock({ n, canvas, resolved, running, pin, saved, adapters, problems, ask, onChange }: CanvasProps) {
  const fresh = resolved && !running.includes(resolved.id);
  // the Koordinator of the canvas with the problem, where it runs: a card for it goes there
  const askHere = ask && ((text: string) => ask(text, resolved && running.includes(resolved.id) ? resolved.id : undefined));
  const here = t.config.canvas(n + 1);
  const setRepo = (i: number, r: RepoConfig | null) => onChange({ ...canvas, repos: r ? canvas.repos.map((x, j) => (j === i ? r : x)) : canvas.repos.filter((_, j) => j !== i) });
  return (
    <div className="cfg-canvas">
      <div className="cfg-canvas-head">
        <h4>{here}</h4>
        <input
          aria-label={t.config.name}
          value={canvas.name ?? ''}
          placeholder={resolved && !canvas.name ? t.config.nameAuto(resolved.name) : t.config.name}
          onChange={(e) => {
            const { name: _, ...rest } = canvas;
            const kept = pin && !rest.id ? { ...rest, id: pin } : rest;
            onChange(e.target.value ? { ...kept, name: e.target.value } : kept);
          }}
        />
        {resolved && (
          <span className={fresh ? 'c-id fresh' : 'c-id'}>
            ?c={resolved.id} · {fresh ? t.config.fresh : t.config.runs}
          </span>
        )}
        <button className="c-del" title={t.config.removeCanvas} onClick={() => onChange(null)}>
          ✕
        </button>
      </div>
      {fresh && <p className="hint warn">{t.config.freshHint}</p>}
      <div className="cfg-repos">
        <span className="hint">{t.config.path}</span>
        <span className="hint">{t.config.adapter}</span>
        <span className="hint cfg-has-info cfg-share">
          {t.config.share} <Info text={t.config.shareHint} />
        </span>
        <span />
        {canvas.repos.map((r, i) => (
          <RepoRow
            key={i}
            repo={r}
            home={i === 0}
            resolved={resolved?.repos[i]}
            canvasId={saved && resolved && running.includes(resolved.id) ? resolved.id : undefined}
            adapters={adapters}
            problems={problems.filter((p) => p.repo === i)}
            where={`${here}, ${t.config.repoAt(r.path)}`}
            ask={askHere}
            onChange={(x) => setRepo(i, x)}
          />
        ))}
      </div>
      {problems
        .filter((p) => p.repo === undefined)
        .map((p, k) => (
          <Problem key={k} problem={p} where={here} ask={askHere} />
        ))}
      <button className="btn small" onClick={() => onChange({ ...canvas, repos: [...canvas.repos, { path: '' }] })}>
        {t.config.addRepo}
      </button>
    </div>
  );
}

interface RepoProps {
  repo: RepoConfig;
  home: boolean;
  resolved?: { id: string; adapter: string; workspaces: 'clones' | 'worktrees'; adapterShares?: boolean; adapterSite?: string };
  /** The running canvas the repository is on, as saved; where a card for it can go. */
  canvasId?: string;
  adapters: string[];
  problems: ConfigProblem[];
  /** Where it is, for a request to the Koordinator. */
  where: string;
  ask?: (text: string) => void;
  onChange: (r: RepoConfig | null) => void;
}

function RepoRow({ repo, home, resolved, canvasId, adapters, problems, where, ask, onChange }: RepoProps) {
  const clones = resolved?.workspaces === 'clones' || !!repo.clones || !!repo.workspaces?.length;
  const without = <K extends keyof RepoConfig>(k: K, v: RepoConfig[K] | undefined): RepoConfig => {
    const next = { ...repo };
    if (v === undefined) delete next[k];
    else next[k] = v;
    return next;
  };
  // one row of the canvas's table of repositories; what only some have (clones, problems) spans the row below it
  return (
    <>
      <div className="cfg-cell">
        <input className="c-path" aria-label={t.config.path} value={repo.path} placeholder={t.config.path} spellCheck={false} onChange={(e) => onChange({ ...repo, path: e.target.value })} />
        {resolved && <span className="hint">{`${resolved.id}${home ? ` · ${t.config.home}` : ''} · ${resolved.workspaces === 'clones' ? t.config.clonesMode : t.config.worktrees}`}</span>}
      </div>
      <div className="cfg-cell">
        <select value={repo.adapter ?? ''} onChange={(e) => onChange(without('adapter', e.target.value || undefined))} aria-label={t.config.adapter}>
          <option value="">{t.config.adapterAuto(repo.adapter ? undefined : resolved?.adapter)}</option>
          {/* a module's path from the file: kept as it is, the dialog offers only the built-in ones */}
          {(repo.adapter && !adapters.includes(repo.adapter) ? [...adapters, repo.adapter] : adapters).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="cfg-cell">
        <input
          className="c-path c-share"
          aria-label={t.config.share}
          value={repo.share ?? ''}
          placeholder={resolved?.adapterSite ? t.config.shareSite(resolved.adapterSite) : resolved?.adapterShares ? t.config.shareAdapter(resolved.adapter) : t.config.shareNone}
          spellCheck={false}
          onChange={(e) => onChange(without('share', e.target.value || undefined))}
        />
      </div>
      <button className="c-del" title={t.config.removeRepo} onClick={() => onChange(null)}>
        ✕
      </button>
      {clones && (
        <div className="cfg-span cfg-clones">
          <label>
            <span className="hint">{t.config.clones}</span>
            <input type="number" min={0} max={20} placeholder="0" value={repo.clones ?? ''} onChange={(e) => onChange(without('clones', Number(e.target.value) || undefined))} />
          </label>
          <label className="cfg-has-info">
            <span className="hint">
              {t.config.slots} <Info text={t.config.slotsHint} />
            </span>
            <input type="number" min={0} max={20} aria-label={t.config.slots} placeholder={t.config.slotsAll} value={repo.slots ?? ''} onChange={(e) => onChange(without('slots', slotsOf(e.target.value)))} />
          </label>
          <label>
            <span className="hint">{t.config.workspaces}</span>
            <textarea
              rows={2}
              spellCheck={false}
              value={(repo.workspaces ?? []).join('\n')}
              onChange={(e) => {
                const list = e.target.value.split('\n');
                onChange(without('workspaces', list.some((w) => w.trim()) ? list : undefined));
              }}
            />
          </label>
          <Hosts hosts={repo.hosts ?? []} onChange={(hosts) => onChange(without('hosts', hosts.length ? hosts : undefined))} />
        </div>
      )}
      {problems.map((p, k) => (
        <div key={k} className="cfg-span">
          <Problem problem={p} where={where} ask={ask} />
        </div>
      ))}
      {/* a repository without an adapter of its own (not one whose own does not load): a card on its canvas writes one */}
      {canvasId && resolved?.adapter === 'generic' && !repo.adapter && !problems.some((p) => p.code === 'adapterLoad') && (
        <div className="cfg-span">
          <AdapterSetup canvas={canvasId} repo={resolved.id} />
        </div>
      )}
    </>
  );
}

/** A slot count as typed: empty is none set (as many as there are clones), 0 takes no new cards. */
function slotsOf(value: string): number | undefined {
  return value.trim() === '' || !Number.isFinite(Number(value)) ? undefined : Math.max(0, Math.round(Number(value)));
}

/** The machines over SSH a repository's workers also run on: a table, one row each. */
function Hosts({ hosts, onChange }: { hosts: HostConfig[]; onChange: (hosts: HostConfig[]) => void }) {
  const set = (i: number, h: HostConfig | null) => onChange(h ? hosts.map((x, k) => (k === i ? h : x)) : hosts.filter((_, k) => k !== i));
  return (
    <div className="cfg-hosts cfg-has-info">
      <span className="hint">
        {t.config.hosts} <Info text={t.config.hostsHint} />
      </span>
      {hosts.length > 0 && (
        <div className="cfg-host-rows">
          {hosts.map((h, i) => (
            <Fragment key={i}>
              <input aria-label={t.config.hostName} value={h.name} placeholder={t.config.hostName} spellCheck={false} onChange={(e) => set(i, { ...h, name: e.target.value })} />
              <input className="c-path" aria-label={t.config.hostSsh} value={h.ssh} placeholder={t.config.hostSsh} spellCheck={false} onChange={(e) => set(i, { ...h, ssh: e.target.value })} />
              <input className="c-path" aria-label={t.config.hostRoot} value={h.root} placeholder={t.config.hostRoot} spellCheck={false} onChange={(e) => set(i, { ...h, root: e.target.value })} />
              <label className="cfg-host-clones">
                <span className="hint">{t.config.hostClones}</span>
                <input type="number" min={0} max={20} value={h.clones} onChange={(e) => set(i, { ...h, clones: Number(e.target.value) || 0 })} />
              </label>
              <label className="cfg-host-clones cfg-has-info">
                <span className="hint">
                  {t.config.hostSlots} <Info text={t.config.slotsHint} />
                </span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  aria-label={t.config.hostSlots}
                  placeholder={t.config.slotsAll}
                  value={h.slots ?? ''}
                  onChange={(e) => {
                    const { slots: _, ...rest } = h;
                    const slots = slotsOf(e.target.value);
                    set(i, slots === undefined ? rest : { ...rest, slots });
                  }}
                />
              </label>
              <button className="c-del" title={t.config.removeHost} onClick={() => set(i, null)}>
                ✕
              </button>
            </Fragment>
          ))}
        </div>
      )}
      <button className="btn small" onClick={() => onChange([...hosts, { name: '', ssh: '', root: '', clones: 2 }])}>
        {t.config.addHost}
      </button>
    </div>
  );
}

// problems whose detail says what to fix, in the repository's adapter rather than here
const DETAILED: ConfigProblem['code'][] = ['adapterField', 'adapterLoad', 'unknownAdapter', 'hostName'];

/**
 * A problem of the configuration: what is wrong, the technical detail folded away where it says
 * what to fix, and a button that has the Koordinator create a task that fixes it (with the detail, which it reads).
 */
function Problem({ problem, where, ask }: { problem: ConfigProblem; where: string; ask?: (text: string) => void }) {
  const [asked, setAsked] = useState(false);
  const text = t.config.problem[problem.code];
  return (
    <div className="p-error c-problem">
      {text}
      {DETAILED.includes(problem.code) && (
        <details>
          <summary>{t.config.details}</summary>
          <code>{problem.detail}</code>
        </details>
      )}
      {ask && (
        <button
          className="btn small"
          disabled={asked}
          onClick={() => {
            setAsked(true);
            ask(t.config.fixRequest(where, text, problem.detail));
          }}
        >
          {t.config.askFix}
        </button>
      )}
    </div>
  );
}

/** Creates the card that writes the repository's adapter, and opens it on its canvas. */
function AdapterSetup({ canvas, repo }: { canvas: string; repo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    try {
      const card = await api.adapterSetup(canvas, repo);
      // the canvas loads with the card open, as after a restart
      keep(sessionStorage, canvas, { at: Date.now(), card: card.id, scroll: [], drafts: [] });
      location.assign(`?c=${encodeURIComponent(canvas)}`);
    } catch (e) {
      setError(e instanceof ApiError ? errorText(e.code) : t.offlineError);
      setBusy(false);
    }
  };
  return (
    <div className="c-row">
      <span className="hint">{t.config.adapterSetupHint}</span>
      <button className="btn small" disabled={busy} onClick={go}>
        {t.config.adapterSetup}
      </button>
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}
