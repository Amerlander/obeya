// Obeya's configuration, in a dialog over the page with its sections listed on the left: the
// canvases it serves and their repositories, edited and saved together (Obeya then starts again
// with them), and the settings saved on their own (models, voice, demos, language). The server's
// own settings come from its command line and show read-only.

import { type CSSProperties, Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, type AgentEffort, type AgentModel, type AgentRole, type AgentSetting, type AgentsView, blocksSaving, type CanvasConfig, type ConfigChecked, type ConfigProblem, type ConfigView, type DemoSettings, type DemoSettingsView, type DemoSite, type DemoVoiceCheck, type Language, type HostConfig, type LanguageView, type NarrationLanguage, restartsAgents, type RepoConfig, type RepoSettings, type RepoValues, type ResolvedCanvas, type SettingsShared, type SettingValue, layerSettings, SHARED_FIELDS, type SetupCheck, type StackSettings, type Theme, THEMES, type ThemeView, type VoiceKind, type VoiceSetupView, withClones } from '../core/types';
import { LANGUAGES } from '../core/locale';
import { pushKeyFromEvent, type PushKeyView } from '../core/push-key';
import { api, ApiError, reload } from './api';
import { keepConfigDraft, keptConfigDraft } from './configDraft';
import { keep } from './keep';
import { demoState, GitSetup, megabytes, PLATFORMS, RecognitionDetail, SetupList, useFolderWithoutGit, voiceState } from './setup';
import { errorText, pushKeyLabel, t } from './strings';
import { applyTheme } from './theme';

declare global {
  interface Window {
    /** Set by the app (app/src/main.rs) in its window; absent in a browser. */
    obeyaApp?: { version: string; platform: string };
  }
}

type Checked = Pick<ConfigChecked, 'resolved' | 'problems'>;

/** Hands the Koordinator a request; to the one of `canvas` where given, else to this page's. */
type Ask = (text: string, canvas?: string) => void;

/** The dialog's sections, in the order its list shows them. */
type Section = 'canvases' | 'agents' | 'voice' | 'demos' | 'general';
const SECTIONS: Section[] = ['canvases', 'agents', 'voice', 'demos', 'general'];
// the section shown, per tab: a new language reloads the page (as a save that restarts Obeya does), and the dialog comes back at it
const SECTION_KEY = 'obeya-config-section';

/** Opens the dialog at the canvases and their repositories next time, as from the note on a plan directory. */
export const showCanvasesSection = () => sessionStorage.setItem(SECTION_KEY, 'canvases');

/** A repository's clone count (or its slots, or one of its settings, folded open) to show and focus when the dialog opens. */
export interface ConfigFocus {
  canvas: string;
  repo: string;
  field: 'clones' | 'slots' | 'settings';
  /** With `settings`: the setting to show. */
  setting?: string;
}
const FOCUS_KEY = 'obeya-config-focus';

/** Opens the dialog next time at a repository's clone count or slots, as from a card waiting for a free clone or slot. */
export const showRepoClones = (f: ConfigFocus) => {
  showCanvasesSection();
  sessionStorage.setItem(FOCUS_KEY, JSON.stringify(f));
};

/** The canvases' draft as written down, with the id each canvas had when loaded. */
type KeptCanvases = { draft: CanvasConfig[]; origin: (string | null)[] };
const ofKept = (k: KeptCanvases) => k.draft;

/**
 * The draft with the ids of its canvases once the check of the configuration as `loaded` resolved
 * them: a canvas without one yet gets the id of the loaded canvas with its repositories, and a
 * running one the owner renamed meanwhile keeps it, as a rename does once the id is known; one they
 * added has none.
 */
function pinned(kept: KeptCanvases, loaded: CanvasConfig[], resolved: Checked['resolved'], running: string[]): KeptCanvases {
  const taken = new Set<number>();
  const out = kept.draft.map((c, i) => {
    if (kept.origin[i]) return { c, id: kept.origin[i]! };
    const j = loaded.findIndex((l, k) => !taken.has(k) && JSON.stringify(l.repos) === JSON.stringify(c.repos));
    if (j < 0) return { c, id: null };
    taken.add(j);
    const id = resolved[j]?.id ?? null;
    return { c: id && running.includes(id) && !c.id && c.name !== loaded[j]!.name ? { ...c, id } : c, id };
  });
  return { draft: out.map((x) => x.c), origin: out.map((x) => x.id) };
}

export function ConfigDialog({ on, onClose, onSetup, onAsk, onTalk, onProblems }: { on: boolean; onClose: () => void; onSetup: () => void; onAsk: Ask; onTalk: () => void; onProblems: (n: number) => void }) {
  const [view, setView] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<CanvasConfig[]>([]);
  const [checked, setChecked] = useState<Checked | null>(null);
  // the check of the configuration as saved: it reads every repository, so it comes after the configuration
  const [saved, setSaved] = useState<Checked | null>(null);
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
  // a repository added here whose settings say clones gets as many as the first canvas's, once it is checked
  const filled = useRef(new Set<string>());
  // the canvases as loaded while their ids are unknown yet: those come with the check of the saved configuration
  const unpinned = useRef<CanvasConfig[] | null>(null);
  const load = (v: ConfigView, c: Checked | null) => {
    filled.current.clear();
    setDraft(v.canvases);
    setOrigin(c ? c.resolved.map((r) => r?.id ?? null) : v.canvases.map(() => null));
    unpinned.current = c ? null : v.canvases;
  };
  const now = useRef({ draft, origin, running: view?.running ?? [] });
  now.current = { draft, origin, running: view?.running ?? [] };
  const savedSeq = useRef(0);
  const checkSaved = () => {
    const n = ++savedSeq.current;
    api.configCheck().then((c) => {
      if (n !== savedSeq.current) return;
      setSaved(c);
      onProblems(c.problems.length);
      const loaded = unpinned.current;
      unpinned.current = null;
      if (!loaded) return;
      const p = pinned(now.current, loaded, c.resolved, now.current.running);
      if (p.draft.some((x, i) => x !== now.current.draft[i])) setDraft(p.draft);
      setOrigin(p.origin);
    }, console.error);
  };

  // the field to show once the canvases are there; a new object each time, so a second jump to the same one still scrolls
  const [focus, setFocus] = useState<ConfigFocus | null>(null);

  const changed = !!view && JSON.stringify(draft) !== JSON.stringify(view.canvases);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  // a draft not saved yet is written down as it changes: a reload (Obeya's restart) brings it back
  useEffect(() => {
    if (view) keepConfigDraft<KeptCanvases>(sessionStorage, 'canvases', { draft, origin }, view.canvases, ofKept);
  }, [draft, origin, view]);
  // read afresh whenever the dialog opens: the Koordinator or the file may have changed it; a draft not saved yet stays, after a reload too
  useEffect(() => {
    if (!on) return;
    const s = sessionStorage.getItem(SECTION_KEY) as Section | null;
    if (s && SECTIONS.includes(s)) setSectionState(s);
    const f = sessionStorage.getItem(FOCUS_KEY);
    sessionStorage.removeItem(FOCUS_KEY);
    setFocus(f ? (JSON.parse(f) as ConfigFocus) : null);
    setSaved(null);
    api.config().then((v) => {
      setView(v);
      const kept = !changedRef.current && keptConfigDraft<KeptCanvases>(sessionStorage, 'canvases', v.canvases, ofKept);
      if (kept) {
        setDraft(kept.draft);
        setOrigin(kept.origin);
        unpinned.current = v.canvases;
      } else if (!changedRef.current) load(v, null);
      setStatus(v.restarting ? t.config.saved : '');
      checkSaved();
    }, console.error);
  }, [on]);

  const take = (c: Checked, checkedDraft: CanvasConfig[]) => {
    setChecked(c);
    const next = view && withClones(checkedDraft, view.canvases, c.resolved, filled.current);
    if (next) setDraft(next);
  };

  // the draft is checked as it is edited: paths, settings, ids; as saved, it has the check of the saved configuration
  const seq = useRef(0);
  useEffect(() => {
    if (!changed) setChecked(saved);
  }, [changed, saved]);
  useEffect(() => {
    if (!view || !changed) return void ++seq.current;
    const n = ++seq.current;
    const h = setTimeout(() => api.checkConfig(draft).then((c) => n === seq.current && take(c, draft), console.error), 300);
    return () => clearTimeout(h);
  }, [draft, view]);

  const problems = checked?.problems ?? [];
  const c = t.config;
  // a path that became a repository here (git set up in its folder): its problem goes
  const recheck = () => {
    const n = ++seq.current;
    api.checkConfig(draft).then((v) => n === seq.current && take(v, draft), console.error);
  };
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
                focus={focus}
                onAsk={onAsk}
                onRecheck={recheck}
                onDraft={(d, o) => {
                  setDraft(d);
                  setOrigin(o);
                }}
                onSave={async () => {
                  setBusy(true);
                  let applies = false;
                  try {
                    const { restarting, applied } = await api.saveConfig(draft);
                    // what is saved now is the draft as last checked; settings applied at once change what the
                    // repositories amount to (where „Für alle“ goes, say), so it is read and checked again
                    const fresh = applied ? await api.config() : null;
                    savedSeq.current++;
                    setSaved(checked);
                    setView({ ...(fresh ?? view), canvases: draft, restarting });
                    checkSaved();
                    setStatus(restarting ? c.saved : applied ? (restartsAgents(view.canvases, draft) ? c.savedRestarts : c.savedApplied) : c.savedOnly);
                    applies = !restarting;
                  } catch (e) {
                    setStatus(e instanceof ApiError ? errorText(e.code) : t.offlineError);
                  }
                  setBusy(false);
                  return applies;
                }}
                onReset={() => load(view, saved)}
                onReload={async () => {
                  const v = await api.config();
                  setView(v);
                  load(v, null);
                  checkSaved();
                }}
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
  focus: ConfigFocus | null;
  onAsk: Ask;
  onRecheck: () => void;
  onDraft: (draft: CanvasConfig[], origin: (string | null)[]) => void;
  /** Saves the draft; says whether it was saved and applies without a restart. */
  onSave: () => Promise<boolean>;
  onReset: () => void;
  /** Reads the saved configuration again: the server changed it (settings taken over for everyone). */
  onReload: () => Promise<void>;
  status: string;
  json: boolean;
  onJson: () => void;
}

/** The canvases with their repositories, saved together; Obeya then starts again with them. */
function Canvases({ view, draft, origin, checked, changed, busy, focus, onAsk, onRecheck, onDraft, onSave, onReset, onReload, status, json, onJson }: CanvasesProps) {
  const c = t.config;
  const problems = checked?.problems ?? [];
  // „Für alle“ takes over what is saved: with changes in the dialog it saves them first, where that applies without a restart
  const prepare = changed && view.source === 'file' && !view.restarting && !problems.some(blocksSaving) ? onSave : undefined;
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
      {!checked && <p className="hint">{c.checking}</p>}
      {draft.map((x, i) => (
        <CanvasBlock
          key={i}
          n={i}
          canvas={x}
          resolved={checked?.resolved[i] ?? null}
          running={view.running}
          pin={origin[i] && view.running.includes(origin[i]) ? origin[i] : undefined}
          saved={!changed}
          problems={problems.filter((p) => p.canvas === i)}
          focus={focus}
          ask={changed ? undefined : onAsk}
          onRecheck={onRecheck}
          onReload={onReload}
          {...(prepare ? { prepare } : {})}
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
        <button className="btn primary" disabled={!changed || busy || problems.some(blocksSaving)} onClick={() => void onSave()}>
          {/* a configuration from the file applies while Obeya runs; one from the command line becomes the file with a restart */}
          {view.server.restarts && (view.source === 'args' || view.restarting) ? c.save : c.saveOnly}
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
      setDraft(keptConfigDraft<DemoSettings>(sessionStorage, 'demo', v.settings) ?? v.settings);
      setStatus('');
    }, console.error);
  }, [on]);
  // a draft not saved yet is written down as it changes: closing the dialog or a reload brings it back
  useEffect(() => {
    if (view && draft) keepConfigDraft(sessionStorage, 'demo', draft, view.settings);
  }, [draft, view]);
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
 * What the owner's voice input needs on this machine, with one button that loads the speech
 * recognition (fetching it the first time) and measures it, and a cloud service instead. Follows
 * an installation until it ends.
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
      <SetupList items={view.items} name={(i) => v.names[i.id]} state={voiceState} action={(i) => i.id === 'recognition' && <RecognitionDetail item={i} busy={running} changed={recheck} />} />
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
  resolved: ConfigChecked['resolved'][number];
  running: string[];
  /** The id of the running canvas this one is: a new name keeps it. */
  pin?: string;
  /** The configuration shown is the one saved: a running canvas is the one shown. */
  saved: boolean;
  problems: ConfigProblem[];
  focus: ConfigFocus | null;
  /** Has the Koordinator create a task that fixes a problem; only for the configuration as saved, which is what it reads. */
  ask?: Ask;
  onRecheck: () => void;
  onReload: () => Promise<void>;
  /** Saves the dialog's changes before settings are taken over for everyone; none where saving restarts Obeya. */
  prepare?: () => Promise<boolean>;
  onChange: (c: CanvasConfig | null) => void;
}

function CanvasBlock({ n, canvas, resolved, running, pin, saved, problems, focus, ask, onRecheck, onReload, prepare, onChange }: CanvasProps) {
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
        <span />
        {canvas.repos.map((r, i) => (
          <RepoRow
            key={i}
            repo={r}
            home={i === 0}
            resolved={resolved?.repos[i]}
            canvasId={saved && resolved && running.includes(resolved.id) ? resolved.id : undefined}
            problems={problems.filter((p) => p.repo === i)}
            {...(focus && resolved?.id === focus.canvas && resolved.repos[i]?.id === focus.repo ? { focus } : {})}
            where={`${here}, ${t.config.repoAt(r.path)}`}
            ask={askHere}
            onRecheck={onRecheck}
            takeover={{ saved, onReload, ...(prepare ? { prepare } : {}) }}
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
  resolved?: ResolvedCanvas['repos'][number];
  /** The running canvas the repository is on, as saved; where a card for it can go. */
  canvasId?: string;
  problems: ConfigProblem[];
  /** Its clone count or slots to scroll to and focus: the dialog was opened from a card waiting for a free clone or slot. */
  focus?: ConfigFocus;
  /** Where it is, for a request to the Koordinator. */
  where: string;
  ask?: (text: string) => void;
  /** Checks the configuration again: git was set up in the repository's folder. */
  onRecheck: () => void;
  takeover: Takeover;
  onChange: (r: RepoConfig | null) => void;
}

/** What „Für alle“ needs of the dialog: whether the canvases are as saved (what is taken over), how to read them again, how to save them first. */
interface Takeover {
  saved: boolean;
  /** Reads the saved configuration again: the server changed it. */
  onReload: () => Promise<void>;
  /** Saves the dialog's changes; none where saving restarts Obeya. Says whether they were saved. */
  prepare?: () => Promise<boolean>;
}

function RepoRow({ repo, home, resolved, canvasId, problems, focus, where, ask, onRecheck, takeover, onChange }: RepoProps) {
  const clonesBox = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const box = clonesBox.current;
    if (!focus || focus.field === 'settings' || !box) return;
    box.scrollIntoView({ block: 'center' });
    box.querySelector<HTMLInputElement>(focus.field === 'slots' ? '.cfg-slots input' : '.cfg-clone-count input')?.focus({ preventScroll: true });
    setFlash(true);
    const h = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(h);
  }, [focus]);
  // a path without a repository that is a folder: git can be set up there
  const noGit = useFolderWithoutGit(problems.some((p) => p.code === 'notRepo') ? repo.path.trim() : '');
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
        {resolved && (
          <span className="hint">{`${resolved.id}${home ? ` · ${t.config.home}` : ''} · ${resolved.workspaces === 'clones' ? t.config.clonesMode : t.config.worktrees}`}</span>
        )}
      </div>
      <button className="c-del" title={t.config.removeRepo} onClick={() => onChange(null)}>
        ✕
      </button>
      {clones && (
        <div ref={clonesBox} className={flash ? 'cfg-span cfg-clones flash' : 'cfg-span cfg-clones'}>
          <label className="cfg-clone-count">
            <span className="hint">{t.config.clones}</span>
            <input type="number" min={0} max={20} placeholder="0" value={repo.clones ?? ''} onChange={(e) => onChange(without('clones', Number(e.target.value) || undefined))} />
          </label>
          <label className="cfg-slots cfg-has-info">
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
      {!clones && resolved && (
        <div ref={clonesBox} className={flash ? 'cfg-span cfg-clones flash' : 'cfg-span cfg-clones'}>
          <label className="cfg-slots cfg-has-info">
            <span className="hint">
              {t.config.slots} <Info text={t.config.slotsWorktreesHint} />
            </span>
            <input type="number" min={0} max={20} aria-label={t.config.slots} placeholder={t.config.slotsAny} value={repo.slots ?? ''} onChange={(e) => onChange(without('slots', slotsOf(e.target.value)))} />
          </label>
        </div>
      )}
      {resolved && (
        <RepoSettingsBlock
          show={focus?.field === 'settings' ? focus : undefined}
          repo={repo}
          values={resolved.values}
          shareTo={resolved.shareTo}
          shareDirect={!!resolved.shareDirect}
          takeover={takeover}
          onShare={(share) => onChange(without('share', share))}
          onChange={(settings) => onChange(without('settings', settings))}
        />
      )}
      {problems.map((p, k) => (
        <div key={k} className="cfg-span">
          <Problem problem={p} where={where} ask={ask} />
          {p.code === 'notRepo' && noGit && <GitSetup key={noGit} path={noGit} confirm={t.setup.git.confirm} onDone={onRecheck} />}
        </div>
      ))}
      {/* a repository without settings of its own, or with an adapter module that said them: a card on its canvas writes them */}
      {canvasId && resolved && (resolved.adapterGone || !fromRepository(resolved.values)) && (
        <div className="cfg-span">
          <AdapterSetup canvas={canvasId} repo={resolved.id} />
        </div>
      )}
    </>
  );
}

/** The settings of a repository, set on this machine (`RepoSettings`); the demo's each on its own. */
type SettingKey = Exclude<keyof RepoSettings, 'demo'> | 'howToRun' | 'site';

/**
 * A repository's settings for this machine, folded under „Einstellungen“ below its row: each shows
 * the value that applies and where it comes from; changing one sets it on this machine, „Zurücksetzen“
 * takes it back to its source. Saved with the configuration; they apply at once.
 */
function RepoSettingsBlock({
  show,
  repo,
  values,
  shareTo,
  shareDirect,
  takeover,
  onShare,
  onChange,
}: {
  /** The setting to fold open, scroll to and mark: the dialog was opened from a proposal for it. */
  show: ConfigFocus | undefined;
  repo: RepoConfig;
  values: RepoValues;
  shareTo: 'main' | 'pr';
  shareDirect: boolean;
  takeover: Takeover;
  /** Sets this machine's share command; none shares on the demo site again, where the settings name one. */
  onShare: (share: string | undefined) => void;
  onChange: (s: RepoSettings | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!show) return;
    setOpen(true);
    setShown(show.setting ?? null);
    const h = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(h);
  }, [show]);
  useEffect(() => {
    if (shown) box.current?.querySelector(`[data-setting="${shown}"]`)?.scrollIntoView({ block: 'center' });
  }, [shown, open]);
  const c = t.config.settings;
  const s = repo.settings ?? {};
  const base: Record<SettingKey, SettingValue<unknown>> = { ...values, howToRun: values.demo.howToRun, site: values.demo.site };
  const own = (k: SettingKey): unknown => (k === 'howToRun' || k === 'site' ? s.demo?.[k] : s[k]);
  const value = <T,>(k: SettingKey) => (own(k) ?? base[k].value) as T;
  const set = (k: SettingKey, v: unknown) => {
    const next: RepoSettings = { ...s };
    if (k === 'howToRun' || k === 'site') {
      const demo: NonNullable<RepoSettings['demo']> = { ...s.demo };
      if (v === undefined) delete demo[k];
      else (demo as Record<string, unknown>)[k] = v;
      if (Object.keys(demo).length) next.demo = demo;
      else delete next.demo;
    } else if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const keys: SettingKey[] = ['branch', 'land', 'direct', 'checks', 'setup', 'planDocs', 'softPaths', 'workspaces', 'prNoise', 'stack', 'howToRun', 'site'];
  // the share command is this machine's too, though not a value „Für alle“ takes over
  const setHere = keys.filter((k) => own(k) !== undefined).length + (repo.share ? 1 : 0);
  const fromRepo = keys.filter((k) => own(k) === undefined && base[k].source === 'repository').length;
  const lines = (k: SettingKey) => value<string[]>(k).join('\n');
  // a setting: its label with where its value comes from (and „Zurücksetzen“ where it is set here), its control and what to know about it
  const field = (key: string, label: string, here: boolean, from: string, reset: () => void, control: ReactNode, hint?: string) => (
    <div className={shown === key ? 'cfg-field cfg-setting flash' : 'cfg-field cfg-setting'} key={key} data-setting={key}>
      <div className="cfg-label">
        {label}
        <span className={here ? 'cfg-source here' : 'cfg-source'}>{here ? c.source.machine : from}</span>
        {here && (
          <button type="button" className="cfg-reset" title={c.resetHint} onClick={reset}>
            {c.reset}
          </button>
        )}
      </div>
      <div className="cfg-control">
        {control}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );
  const row = (k: SettingKey, label: string, control: ReactNode, hint?: string) => {
    const from = base[k].source;
    return field(k, label, own(k) !== undefined, c.source[from], () => set(k, undefined), control, hint);
  };
  const land = value<'main' | 'pr'>('land');
  const planDocs = value<{ dir: string; exclude: string[] }>('planDocs');
  const stack = value<StackSettings | null>('stack') ?? { start: '' };
  const setStack = (patch: Partial<StackSettings>) => set('stack', { ...stack, ...patch });
  const site = value<DemoSite | null>('site') ?? { title: '', url: '', deploy: '' };
  const setSite = (patch: Partial<DemoSite>) => set('site', { ...site, ...patch });
  const urls = stack.urls ?? { file: '', frontendKey: '' };
  const siteUsable = !!site.title.trim() && !!site.url.trim() && !!site.deploy.trim();
  // a part of a setting with several fields: its label above it; a wide one takes the whole row
  const sub = (label: string, control: ReactNode, wide = false) => (
    <label className={wide ? 'wide' : undefined}>
      <span className="hint">{label}</span>
      {control}
    </label>
  );
  return (
    <div className="cfg-span cfg-settings" ref={box}>
      <button type="button" className={open ? 'cfg-settings-toggle on' : 'cfg-settings-toggle'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="cfg-caret" aria-hidden="true" />
        {c.open}
        <span className="hint">
          {[value<string>('branch'), c.lands[land], ...(setHere ? [c.setHere(setHere)] : []), ...(fromRepo ? [c.fromRepo(fromRepo)] : [])].join(' · ')}
        </span>
      </button>
      {open && (
        <div className="cfg-settings-body">
          <p className="hint">{c.hint}</p>
          {row('branch', c.branch, <input className="c-path" aria-label={c.branch} spellCheck={false} value={value<string>('branch')} onChange={(e) => set('branch', e.target.value)} />, c.branchHint)}
          {row(
            'land',
            c.land,
            <div className="seg" role="radiogroup" aria-label={c.land}>
              {(['main', 'pr'] as const).map((x) => (
                <button key={x} type="button" role="radio" aria-checked={land === x} className={land === x ? 'on' : undefined} onClick={() => set('land', x)}>
                  {c.lands[x]}
                </button>
              ))}
            </div>,
            c.landHint,
          )}
          {land === 'pr' &&
            row(
              'direct',
              c.direct,
              <label className="c-check">
                <input type="checkbox" checked={value<boolean>('direct')} onChange={(e) => set('direct', e.target.checked)} />
                {c.directLabel}
              </label>,
            )}
          {row('checks', c.checks, <textarea rows={Math.max(2, value<string[]>('checks').length + 1)} spellCheck={false} aria-label={c.checks} value={lines('checks')} onChange={(e) => set('checks', e.target.value.split('\n'))} />, c.checksHint)}
          {row('setup', c.setup, <input className="c-path" aria-label={c.setup} spellCheck={false} value={value<string>('setup')} onChange={(e) => set('setup', e.target.value)} />, c.setupHint)}
          {row(
            'planDocs',
            c.planDocs,
            <div className="cfg-plan">
              <input className="c-path" aria-label={c.planDir} placeholder={c.planDir} spellCheck={false} value={planDocs.dir} onChange={(e) => set('planDocs', { ...planDocs, dir: e.target.value })} />
              <input className="c-path" aria-label={c.planExclude} placeholder={c.planExclude} spellCheck={false} value={planDocs.exclude.join(', ')} onChange={(e) => set('planDocs', { ...planDocs, exclude: e.target.value.split(/,\s*/) })} />
            </div>,
          )}
          {row('softPaths', c.softPaths, <textarea rows={Math.max(2, value<string[]>('softPaths').length + 1)} spellCheck={false} aria-label={c.softPaths} value={lines('softPaths')} onChange={(e) => set('softPaths', e.target.value.split('\n'))} />, c.softPathsHint)}
          {row(
            'workspaces',
            c.workspaces,
            base.workspaces.source === 'clones' ? (
              <span>{c.workspacesClones}</span>
            ) : (
              <div className="seg" role="radiogroup" aria-label={c.workspaces}>
                {(['worktrees', 'clones'] as const).map((x) => (
                  <button key={x} type="button" role="radio" aria-checked={value('workspaces') === x} className={value('workspaces') === x ? 'on' : undefined} onClick={() => set('workspaces', x)}>
                    {c.workIn[x]}
                  </button>
                ))}
              </div>
            ),
            base.workspaces.source === 'clones' ? undefined : c.workspacesHint,
          )}
          {land === 'pr' && row('prNoise', c.prNoise, <textarea rows={2} spellCheck={false} aria-label={c.prNoise} value={lines('prNoise')} onChange={(e) => set('prNoise', e.target.value.split('\n'))} />, c.prNoiseHint)}
          {row(
            'stack',
            c.stack,
            <div className="cfg-sub">
              {sub(c.stackStart, <input className="c-path" aria-label={c.stackStart} placeholder="docker compose up -d && pnpm dev" spellCheck={false} value={stack.start} onChange={(e) => setStack({ start: e.target.value })} />, true)}
              {sub(c.stackRefresh, <input className="c-path" aria-label={c.stackRefresh} spellCheck={false} value={stack.refresh ?? ''} onChange={(e) => setStack({ refresh: e.target.value })} />, true)}
              {sub(c.stackUrlFile, <input className="c-path" aria-label={c.stackUrlFile} placeholder=".dev-urls" spellCheck={false} value={urls.file} onChange={(e) => setStack({ urls: { ...urls, file: e.target.value } })} />)}
              {sub(c.stackFrontendKey, <input className="c-path" aria-label={c.stackFrontendKey} placeholder="WEB_URL" spellCheck={false} value={urls.frontendKey} onChange={(e) => setStack({ urls: { ...urls, frontendKey: e.target.value } })} />)}
              {sub(c.stackStop, <input className="c-path" aria-label={c.stackStop} placeholder="docker compose down" spellCheck={false} value={stack.stop ?? ''} onChange={(e) => setStack({ stop: e.target.value })} />)}
              {sub(c.stackKeep, <input className="c-path" aria-label={c.stackKeep} spellCheck={false} value={stack.keep ?? ''} onChange={(e) => setStack({ keep: e.target.value })} />)}
            </div>,
            c.stackHint,
          )}
          {row('howToRun', c.howToRun, <textarea rows={Math.max(3, Math.ceil(value<string>('howToRun').length / 90) + 1)} aria-label={c.howToRun} value={value<string>('howToRun')} onChange={(e) => set('howToRun', e.target.value)} />, c.howToRunHint)}
          {row(
            'site',
            c.site,
            <div className="cfg-sub">
              {sub(c.siteTitle, <input className="c-path" aria-label={c.siteTitle} spellCheck={false} value={site.title} onChange={(e) => setSite({ title: e.target.value })} />)}
              {sub(c.siteUrl, <input className="c-path" aria-label={c.siteUrl} placeholder="https://demos.example.com" spellCheck={false} value={site.url} onChange={(e) => setSite({ url: e.target.value })} />)}
              {sub(c.siteDeploy, <input className="c-path" aria-label={c.siteDeploy} placeholder="bunx wrangler@4 pages deploy {dir} --project-name demos" spellCheck={false} value={site.deploy} onChange={(e) => setSite({ deploy: e.target.value })} />, true)}
              {sub(c.siteEnv, <input className="c-path" aria-label={c.siteEnv} placeholder="sites/demos/deploy.env" spellCheck={false} value={site.env ?? ''} onChange={(e) => setSite({ env: e.target.value })} />, true)}
              {sub(
                c.siteHeaders,
                <textarea
                  rows={Math.max(2, Object.keys(site.headers ?? {}).length + 1)}
                  spellCheck={false}
                  aria-label={c.siteHeaders}
                  placeholder={'CF-Access-Client-Id: ${CF_ID}'}
                  value={Object.entries(site.headers ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('\n')}
                  onChange={(e) => setSite({ headers: headerLines(e.target.value) })}
                />,
                true,
              )}
              {sub(
                c.siteMaxFile,
                <input
                  className="c-path"
                  type="number"
                  min={1}
                  aria-label={c.siteMaxFile}
                  placeholder="25"
                  value={site.maxFile ? Math.round(site.maxFile / MIB) : ''}
                  onChange={(e) => setSite({ maxFile: Number(e.target.value) > 0 ? Math.round(Number(e.target.value) * MIB) : undefined })}
                />,
              )}
              {sub(
                c.siteLanguageLabel,
                <div className="seg" role="radiogroup" aria-label={c.siteLanguageLabel}>
                  {([undefined, 'de', 'en'] as const).map((x) => (
                    <button key={x ?? 'auto'} type="button" role="radio" aria-checked={site.language === x} className={site.language === x ? 'on' : undefined} onClick={() => setSite({ language: x })}>
                      {c.siteLanguage[x ?? 'auto']}
                    </button>
                  ))}
                </div>,
              )}
            </div>,
            c.siteHint,
          )}
          {field(
            'share',
            t.config.share,
            !!repo.share,
            c.source.default,
            () => onShare(undefined),
            <input
              className="c-path"
              aria-label={t.config.share}
              value={repo.share ?? ''}
              placeholder={siteUsable ? t.config.shareSite(site.url) : t.config.shareNone}
              spellCheck={false}
              onChange={(e) => onShare(e.target.value || undefined)}
            />,
            t.config.shareHint,
          )}
          <ShareSettings repo={repo} values={values} branch={value<string>('branch')} shareTo={shareTo} shareDirect={shareDirect} takeover={takeover} />
        </div>
      )}
    </div>
  );
}

/** Whether the repository has settings for everyone (`.obeya/settings.json`): then it is set up. */
const fromRepository = (v: RepoValues) => SHARED_FIELDS.some((k) => (k === 'demo' ? v.demo.howToRun.source === 'repository' || v.demo.site.source === 'repository' : v[k].source === 'repository'));

const MIB = 1024 * 1024;

/** The headers of `Name: value` lines; none for lines without a name. */
function headerLines(text: string): Record<string, string> | undefined {
  const pairs = text
    .split('\n')
    .map((l) => l.match(/^([^:]+):\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && !!m[1]!.trim())
    .map((m) => [m[1]!.trim(), m[2]!] as const);
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

/** The repository's `.obeya/settings.json` as the dialog shows it: what the file holds now (`values` from the repository) with this machine's settings in front, but the main branch. */
function sharedPreview(repo: RepoConfig, values: RepoValues): Record<string, unknown> {
  const file: Record<string, unknown> = {};
  for (const k of SHARED_FIELDS) {
    if (k === 'demo') continue;
    if (values[k].source === 'repository') file[k] = values[k].value;
  }
  const { howToRun, site } = values.demo;
  if (howToRun.source === 'repository' || site.source === 'repository')
    file.demo = { ...(howToRun.source === 'repository' ? { howToRun: howToRun.value } : {}), ...(site.source === 'repository' ? { site: site.value } : {}) };
  const { branch: _, ...mine } = repo.settings ?? {};
  const merged = layerSettings<Record<string, unknown>>(file, mine as Record<string, unknown>) ?? {};
  return Object.fromEntries(SHARED_FIELDS.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]));
}

/**
 * „Für alle ins Repository übernehmen“ under a repository's settings: this machine's values (but
 * the main branch) go into its `.obeya/settings.json`, so that everyone who clones it gets them.
 * It first shows the file as it would be and where it goes (a commit on the main branch, or a pull
 * request), then does it at the owner's word. Only for the configuration as saved.
 */
function ShareSettings({ repo, values, branch, shareTo, shareDirect, takeover }: { repo: RepoConfig; values: RepoValues; branch: string; shareTo: 'main' | 'pr'; shareDirect: boolean; takeover: Takeover }) {
  const c = t.config.settings.share;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SettingsShared | null>(null);
  const [error, setError] = useState('');
  const { branch: _, ...mine } = repo.settings ?? {};
  const count = Object.keys(mine).length + (mine.demo ? Object.keys(mine.demo).length - 1 : 0);
  const { saved, onReload, prepare } = takeover;
  const go = async (direct = false) => {
    setBusy(true);
    setError('');
    try {
      // what is taken over is what is saved: the dialog's changes are saved first (why not, its status line says)
      if (!saved && !(await prepare?.())) return setBusy(false);
      const r = await api.shareSettings(repo.path, direct);
      setDone(r);
      setConfirming(false);
      if ('committed' in r) await onReload();
    } catch (e) {
      setError(e instanceof ApiError ? `${errorText(e.code)}${e.code === 'settingsShare' ? ` ${e.message}` : ''}` : t.offlineError);
    }
    setBusy(false);
  };
  return (
    <div className="cfg-field cfg-setting cfg-share-settings">
      <div className="cfg-label">{c.label}</div>
      <div className="cfg-control">
        {done && 'committed' in done && <p className="hint ok">{c.committed(done.branch, done.committed.slice(0, 7))}</p>}
        {done && 'pr' in done && (
          <p className="hint ok">
            {c.opened}{' '}
            <a href={done.pr} target="_blank" rel="noreferrer">
              {done.pr}
            </a>
            {c.openedAfter}
          </p>
        )}
        {!done && !count && <p className="hint">{c.none}</p>}
        {!done && count > 0 && !confirming && (
          <>
            <button type="button" className="btn small" disabled={!saved && !prepare} onClick={() => setConfirming(true)}>
              {c.button(count)}
            </button>
            <p className="hint">{saved || prepare ? `${c.hint}${repo.settings?.branch ? ` ${c.hintBranch}` : ''}` : c.saveFirst}</p>
          </>
        )}
        {confirming && (
          <div className="cfg-share-confirm">
            {!saved && <p className="hint">{c.savesFirst}</p>}
            <p className="hint">{shareTo === 'main' ? c.toMain(branch) : shareDirect ? c.toPrOrDirect(branch) : c.toPr(branch)}</p>
            <pre className="c-json">
              <span className="hint">.obeya/settings.json</span>
              {'\n'}
              {JSON.stringify(sharedPreview(repo, values), null, 2)}
            </pre>
            <div className="cfg-share-actions">
              <button type="button" className="btn primary small" disabled={busy} onClick={() => go()}>
                {shareTo === 'main' ? c.commit : c.openPr}
              </button>
              {shareTo === 'pr' && shareDirect && (
                <button type="button" className="btn small" disabled={busy} onClick={() => go(true)}>
                  {c.pushDirect(branch)}
                </button>
              )}
              <button type="button" className="btn small" disabled={busy} onClick={() => setConfirming(false)}>
                {c.cancel}
              </button>
            </div>
          </div>
        )}
        {error && <p className="hint warn">{error}</p>}
      </div>
    </div>
  );
}

/** A slot count as typed: empty is none set (as many as there are clones, any number in worktrees), 0 takes no new cards. */
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

// problems whose detail says what to fix, in the repository's settings rather than here
const DETAILED: ConfigProblem['code'][] = ['demoSite', 'adapterGone', 'repoSettings', 'hostName'];

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

/** Creates the card that writes the repository's settings for everyone, and opens it on its canvas. */
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
