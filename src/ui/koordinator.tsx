// The Koordinator's sheet: the conversation, with the height the sheet has, and below it sections
// that open and close: the rules it learned and proposes, with the values for repositories'
// settings the Arbeitsrückschau proposes, and the owner's preferences; shared demos to bring
// up to date at once; and at its foot the link to a wish or a bug for Obeya's makers.

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Item, Preference, RepoRef, Reshare, SettingProposal, Talk, TalkQuote, TalkRef } from '../core/types';
import { api } from './api';
import { Inline, plain } from './markdown';
import { AnswerFiles, Body, Continues, Msg, Quote, Reading, ThreadCard } from './message';
import { type Reply, setReply, talkEv, talkQuote, useReplyKnown } from './reply';
import { failText, t } from './strings';
import { Composer } from './composer';
import { OBEYA_DRAFT } from './draft';
import { Shots } from './shots';
import { useStickToEnd } from './stickToEnd';
import { useFitHeight } from './fitHeight';
import { PageChangeList } from './page-changes';
import { useStoredState } from './stored';
import { WishLink, WishReplyLink } from './wish';

interface Props {
  on: boolean;
  /** The canvas, whose sections stay open or closed as the owner left them. */
  canvas: string;
  /** A command typed in the sheet, maybe in reply to a message of it: read like a spoken one; the conversation shows it at once. */
  onTell: (text: string, images?: string[], replyTo?: Reply['to']) => void;
  items: Item[];
  preferences: Preference[];
  /** Values for repositories' settings the Arbeitsrückschau proposes. */
  settings: SettingProposal[];
  /** The canvas's repositories, whose CLAUDE.md a proposal may go into. */
  repos: RepoRef[];
  talk: Talk[];
  reshare?: Reshare;
  onOpen: (i: Item) => void;
  /** Opens the configuration dialog at a repository's setting. */
  onConfig: (repo: string, setting: string) => void;
}

export function KoordinatorSheet({ on, canvas, items, preferences, settings, repos, talk, reshare, onOpen, onTell, onConfig }: Props) {
  const proposals = preferences.filter((p) => p.state === 'proposed');
  const rules = preferences.filter((p) => p.state === 'active');
  const [folds, setFolds] = useStoredState<Folds>(`obeya-ksheet-${canvas}`, {});
  const fresh = useRead(on, talk);
  // the proposals stay closed only as long as no proposal came after the owner closed them; a setting's id counts negative beside the rules'
  const ids = [...proposals.map((p) => p.id), ...settings.map((p) => -p.id)];
  const proposalsOpen = !folds.proposalsClosed || ids.some((id) => !folds.proposalsClosed!.includes(id));
  return (
    <aside id="ksheet" className={on ? 'sheet on' : 'sheet'}>
      <h2>{t.koordinator.title}</h2>
      <Conversation talk={talk} fresh={fresh} items={items} onOpen={onOpen} />
      {/* a command in writing, for when speaking is not possible; its screenshots go to the cards it creates or concerns */}
      <Composer className="tell" draft={OBEYA_DRAFT} placeholder={t.voice.typePlaceholder} obeya onSend={onTell} />

      <div className="k-rest">
        {ids.length > 0 && (
          <Fold
            kind="proposals"
            head={t.koordinator.proposalsHead(ids.length)}
            open={proposalsOpen}
            onToggle={() => setFolds({ ...folds, proposalsClosed: proposalsOpen ? ids : undefined })}
          >
            {proposals.length > 0 && (
              <>
                <p className="hint">{t.koordinator.proposalsHint}</p>
                <ul className="prefs proposals">
                  {proposals.map((p) => (
                    <ProposalRow key={p.id} p={p} items={items} rules={rules} repos={repos} onOpen={onOpen} />
                  ))}
                </ul>
              </>
            )}
            {settings.length > 0 && (
              <>
                <p className="hint">{t.koordinator.settingsHint}</p>
                <ul className="prefs proposals">
                  {settings.map((p) => (
                    <SettingRow key={p.id} p={p} items={items} repo={repos.find((r) => r.id === p.repo)} onOpen={onOpen} onConfig={() => onConfig(p.repo, p.field)} />
                  ))}
                </ul>
              </>
            )}
          </Fold>
        )}

        {reshare && <ReshareBox r={reshare} items={items} onOpen={onOpen} />}

        <Fold head={t.koordinator.preferencesHead(rules.length)} open={!!folds.preferences} onToggle={() => setFolds({ ...folds, preferences: !folds.preferences })}>
          <p className="hint">{t.koordinator.preferencesHint}</p>
          <ul className="prefs">
            {rules.map((p) => (
              <PreferenceRow key={p.id} p={p} />
            ))}
          </ul>
          <NewPreference repos={repos} />
        </Fold>

        <WishLink className="k-foot" />
      </div>
    </aside>
  );
}

/**
 * Answers that came while the owner was elsewhere are read once the sheet is in view (open, and the
 * page not hidden); those that were waiting stay marked until it closes, so the owner sees which.
 */
function useRead(on: boolean, talk: Talk[]): number[] {
  const [fresh, setFresh] = useState<number[]>([]);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const seen = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);
  const unread = talk.filter((x) => x.unread).map((x) => x.id);
  useEffect(() => {
    if (!on) return setFresh([]);
    if (!visible || !unread.length) return;
    setFresh((f) => [...f, ...unread.filter((id) => !f.includes(id))]);
    api.readTalk().catch(() => {});
  }, [on, visible, unread.join()]);
  return fresh;
}

/** Which of the sheet's sections the owner opened, per canvas; the proposals are open unless closed, with the ones open then. */
interface Folds {
  preferences?: boolean;
  proposalsClosed?: number[];
}

/** A section under the conversation: a head with its count that opens and closes it. */
function Fold({ kind, head, open, onToggle, children }: { kind?: string; head: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={['fold', kind, open && 'open'].filter(Boolean).join(' ')}>
      <button className="fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="arrow" />
        {head}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

/**
 * What the owner said to the Koordinator with no card open, and its replies; newest last. The owner
 * can reply to each message, as on a card: it stands quoted above the field, and above the words
 * that reply to it.
 */
function Conversation({ talk, fresh, items, onOpen }: { talk: Talk[]; fresh: number[]; items: Item[]; onOpen: (i: Item) => void }) {
  const box = useRef<HTMLDivElement>(null);
  // every change on the canvas brings a new snapshot: only what the owner just said takes the
  // conversation back to its end, so they can read further up in the meantime
  const onScroll = useStickToEnd(box, talk.at(-1)?.id, talk);
  const known = useReplyKnown();
  if (!talk.length) return null;
  return (
    <div
      className={known ? 'talk conv' : 'talk conv reply-new'}
      ref={box}
      onScroll={onScroll}
    >
      {talk.map((x) => {
        // the owner replies to one of the exchange's messages
        const reply = (part: TalkRef['part'], by: TalkQuote['by'], text: string) => () => {
          const q = { talk: x.id, part, by, text };
          setReply(OBEYA_DRAFT, { to: { talk: x.id, part }, quote: talkQuote(q) });
        };
        return (
          <Fragment key={x.id}>
            <Msg by="owner" who={t.author.owner} at={x.at} ev={talkEv({ talk: x.id, part: 'said' })} onReply={reply('said', 'owner', x.said)}>
              {x.replyTo && <Quote q={talkQuote(x.replyTo)} />}
              <Body md={x.said} />
              <Shots ids={x.images} />
              {x.continues && <Continues question={x.continues} reading={x.answer === undefined && !x.movedTo} />}
            </Msg>
            {x.reply === undefined ? (
              <Reading />
            ) : (
              <Msg
                by="koordinator"
                className={x.undone ? 'undone' : undefined}
                who={t.author.koordinator}
                at={x.at}
                ev={talkEv({ talk: x.id, part: 'reply' })}
                onReply={reply('reply', 'koordinator', x.reply)}
              >
                <Body md={x.reply} />
                {x.wish && !x.undone && <WishReplyLink wish={x.wish} />}
                {x.undone && <div className="hint">{t.koordinator.undone}</div>}
              </Msg>
            )}
            {/* a thread moved onto a Question card goes on there: a line leads to it */}
            {x.movedTo ? (
              <div className="moved">
                <ThreadCard thread={x.thread!} card={items.find((i) => i.id === x.movedTo)} onOpen={onOpen} />
              </div>
            ) : (
              <>
                {/* a question it looked up: the answer follows the acknowledgement */}
                {x.question && x.answer === undefined && (
                  <Msg by="koordinator" className="thinking" who={t.author.koordinator}>
                    <div className="hint">{t.koordinator.lookingUp}</div>
                  </Msg>
                )}
                {x.answer !== undefined && (
                  <Msg
                    by={x.answerBy ?? 'koordinator'}
                    className={fresh.includes(x.id) ? 'fresh' : undefined}
                    who={t.author[x.answerBy ?? 'koordinator']}
                    ev={talkEv({ talk: x.id, part: 'answer' })}
                    onReply={reply('answer', x.answerBy ?? 'koordinator', x.answer)}
                    head={x.thread !== undefined && <ThreadCard thread={x.thread} onOpen={onOpen} />}
                  >
                    <Body md={x.answer} />
                    {x.thread !== undefined && <AnswerFiles thread={x.thread} files={x.files} />}
                  </Msg>
                )}
              </>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** An error to show under a row, and `act`, which runs a request and then shows its error or clears it. */
function useAct(fail?: Parameters<typeof failText>[1]): [string, (fn: () => Promise<unknown>) => Promise<void>] {
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
    } catch (e) {
      setError(failText(e, fail));
    }
  };
  return [error, act];
}

/** A card named in a row, which opens it while it is still on the canvas. */
function CardLink({ card, title, onOpen }: { card: Item | undefined; title: string; onOpen: (i: Item) => void }) {
  return card ? (
    <a className="from" onClick={() => onOpen(card)}>
      {plain(title)}
    </a>
  ) : (
    plain(title)
  );
}

/** Where a rule goes: the owner's preferences or a repository's CLAUDE.md. */
function TargetPick({ value, repos, onChange }: { value: string; repos: RepoRef[]; onChange: (target: string) => void }) {
  return (
    <label className="target">
      {t.koordinator.target}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t.koordinator.targetPreferences}</option>
        {repos.map((r) => (
          <option key={r.id} value={r.id}>
            {t.koordinator.targetClaudeMd(r.name)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A rule's text being edited in place: Enter takes it, Escape leaves it as it was. */
function RuleEdit({ draft, setDraft, onEnter, onBlur }: { draft: string; setDraft: (d: string | null) => void; onEnter: () => void; onBlur?: () => void }) {
  return (
    <textarea
      data-esc
      autoFocus
      value={draft}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/**
 * A rule the Koordinator learned, with where it came from and where it goes (the preferences, or a
 * repository's CLAUDE.md): the owner accepts it, in their own words and for another place if they
 * like, or rejects it.
 */
function ProposalRow({ p, items, rules, repos, onOpen }: { p: Preference; items: Item[]; rules: Preference[]; repos: RepoRef[]; onOpen: (i: Item) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [target, setTarget] = useState(p.target ?? '');
  const [error, decide] = useAct();
  const card = p.cardId ? items.find((i) => i.id === p.cardId) : undefined;
  const replaced = p.replaces !== undefined ? rules.find((r) => r.id === p.replaces) : undefined;
  const accept = () =>
    decide(() => api.acceptProposal(p.id, draft === null || draft.trim() === p.text ? undefined : draft.trim(), target === (p.target ?? '') ? undefined : target || null));
  const quote = p.quote && (p.quote.length > 200 ? `${p.quote.slice(0, 200).trimEnd()} …` : p.quote);
  return (
    <li className="proposal">
      {draft === null ? (
        <span className="pref-text">{p.text}</span>
      ) : (
        <RuleEdit draft={draft} setDraft={setDraft} onEnter={() => draft.trim() && accept()} />
      )}
      {replaced && <span className="occasion">{t.koordinator.changes(replaced.text)}</span>}
      <span className="occasion">
        {p.review ? (
          <>
            {t.koordinator.fromReview}
            {quote && `: ${quote}`}
          </>
        ) : (
          <>
            {card && <CardLink card={card} title={card.title} onOpen={onOpen} />}
            {card && quote && ': '}
            {quote && <q>{quote}</q>}
          </>
        )}
      </span>
      <TargetPick value={target} repos={repos} onChange={setTarget} />
      <span className="pref-actions">
        <button className="btn primary" disabled={draft !== null && !draft.trim()} onClick={accept}>
          {t.koordinator.accept}
        </button>
        {draft === null ? (
          <button className="btn" onClick={() => setDraft(p.text)}>
            {t.koordinator.change}
          </button>
        ) : (
          <button className="btn" onClick={() => setDraft(null)}>
            {t.koordinator.cancel}
          </button>
        )}
        <button className="btn danger" onClick={() => decide(() => api.rejectProposal(p.id))}>
          {t.koordinator.reject}
        </button>
      </span>
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** A cog: what a setting proposal changes is the configuration. */
function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * The value of a setting proposal as the owner edits it, kept per tab while it waits, so an edit
 * outlives closing the sheet and a page load.
 */
function useSettingDraft(id: number, proposed: string): [string, (v: string) => void] {
  const key = `obeya-setting-draft-${id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(key) ?? proposed);
  return [
    draft,
    (v) => {
      setDraft(v);
      try {
        if (v === proposed) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, v);
      } catch {}
    },
  ];
}

/** A value as the owner reads and edits it: a list one entry a line. */
const asText = (v: string | string[]) => (Array.isArray(v) ? v.join('\n') : v);

/**
 * A value for a repository's setting the Arbeitsrückschau proposes, with the cards it rests on and
 * the value it would replace: the owner takes it, as it is or changed, on this machine or into the
 * repository for everyone (neither is the default: they choose each time), or rejects it.
 */
function SettingRow({ p, items, repo, onOpen, onConfig }: { p: SettingProposal; items: Item[]; repo: RepoRef | undefined; onOpen: (i: Item) => void; onConfig: () => void }) {
  const [draft, setDraft] = useSettingDraft(p.id, asText(p.value));
  const field = useRef<HTMLTextAreaElement>(null);
  useFitHeight(field, draft);
  const [busy, setBusy] = useState(false);
  const [error, act] = useAct({ detail: ['settingsShare'] });
  const k = t.koordinator;
  const list = Array.isArray(p.value);
  const decide = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await act(fn);
    setBusy(false);
  };
  const changed = draft.trim() !== asText(p.value);
  const edited = !changed ? undefined : list ? draft.split('\n').map((x) => x.trim()).filter(Boolean) : draft.trim();
  const take = (where: 'machine' | 'repository') => decide(() => api.takeSetting(p.id, where, edited));
  const now = p.now === undefined ? null : asText(p.now).trim();
  const branch = repo?.branch ?? 'main';
  const everyone = repo?.pullRequests ? k.forEveryonePr(branch) : k.forEveryoneMain(branch);
  return (
    <li className="proposal setting">
      <span className="setting-kind">
        <GearIcon />
        {k.settingKind(repo?.name ?? p.repo)}
      </span>
      <span className="setting-name">
        <span className="pref-text">{t.config.settings[p.field]}</span>
        <a className="from" title={k.openConfigHint} onClick={onConfig}>
          {k.openConfig}
        </a>
      </span>
      <span className="setting-diff">
        {now !== null && (
          <>
            <span className="setting-label">{k.settingWas}</span>
            <pre className={now ? 'setting-value was' : 'setting-value was setting-none'}>{now || k.settingEmpty}</pre>
          </>
        )}
        <span className="setting-label">{k.settingNew}</span>
        <span className="setting-new">
          <textarea ref={field} className="setting-value" aria-label={k.settingNew} spellCheck={false} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <span className="setting-edit">
            {changed ? (
              <>
                {k.settingEdited}{' '}
                <a className="from" onClick={() => setDraft(asText(p.value))}>
                  {k.settingRestore}
                </a>
              </>
            ) : (
              k.settingEditable
            )}
          </span>
        </span>
      </span>
      <span className="occasion">
        {k.fromRetro}: <Inline md={p.basis} />{' '}
        {p.cards.map((c, i) => {
          const card = items.find((x) => x.id === c.id);
          return (
            <Fragment key={c.id}>
              {i > 0 && ', '}
              <CardLink card={card} title={c.title} onOpen={onOpen} />
            </Fragment>
          );
        })}
      </span>
      <span className="pref-actions">
        <span className="take-on">{k.takeOn}</span>
        <button className="btn primary" disabled={busy || !draft.trim()} title={k.onMachineHint} onClick={() => take('machine')}>
          {k.onMachine}
        </button>
        <button className="btn primary" disabled={busy || !draft.trim()} title={everyone} onClick={() => take('repository')}>
          {k.forEveryone}
        </button>
      </span>
      <span className="occasion">
        {k.onMachine}: {k.onMachineHint} {k.forEveryone}: {everyone}
      </span>
      <span className="pref-actions">
        <button className="btn danger" disabled={busy} onClick={() => decide(() => api.rejectSetting(p.id))}>
          {k.reject}
        </button>
      </span>
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** How many of the outdated shared demos to share again at once: the newest few, or all. */
const RESHARE_COUNTS = [10, 20, 50, 100];

/**
 * Shared demos whose pages are made differently now: shared again many at once, the newest first,
 * one after the other, with how far it got and which failed.
 */
function ReshareBox({ r, items, onOpen }: { r: Reshare; items: Item[]; onOpen: (i: Item) => void }) {
  const counts = RESHARE_COUNTS.filter((n) => n < r.outdated);
  const [pick, setPick] = useState<number | 'all'>();
  const [error, act] = useAct();
  // the newest 20 unless the owner picks otherwise; null is all of them
  const chosen = pick === 'all' ? null : pick !== undefined && counts.includes(pick) ? pick : (counts.find((n) => n >= 20) ?? null);
  const run = r.run;
  const going = !!run && run.left > 0;
  const s = t.koordinator.reshare;
  const out = run ? run.done + run.failed.length : 0;
  return (
    <div className="reshare">
      <ul className="prefs proposals">
        {run && (
          <li>
            <span className="pref-text">{going ? s.progress(out, run.total) : run.stopped ? s.stopped(run.done, run.total) : s.finished(run.done, run.total)}</span>
            <span className="bar">
              <span style={{ width: `${run.total ? (100 * out) / run.total : 100}%` }} />
            </span>
            {going && run.current && <span className="occasion">{s.now(plain(run.current))}</span>}
            {run.failed.length > 0 && (
              <span className="occasion">
                {s.failed(run.failed.length)}
                {run.failed.map((f) => {
                  const card = items.find((i) => i.id === f.id);
                  return (
                    <span key={f.id} className="failed">
                      <CardLink card={card} title={f.title} onOpen={onOpen} />
                    </span>
                  );
                })}
              </span>
            )}
            {/* beside the notice of outdated pages, its "Ausblenden" puts both away */}
            {(going || !r.outdated) && (
              <span className="pref-actions">
                {going ? (
                  <button className="btn" title={s.stopHint} disabled={!!run.stopped} onClick={() => act(api.stopReshare)}>
                    {s.stop}
                  </button>
                ) : (
                  <button className="btn" onClick={() => act(api.dismissReshare)}>
                    {s.dismiss}
                  </button>
                )}
              </span>
            )}
          </li>
        )}
        {r.outdated > 0 && !going && (
          <li>
            <span className="pref-text">{s.outdated(r.outdated)}</span>
            <span className="occasion">{s.outdatedHint}</span>
            {r.changes && <PageChangeList changes={r.changes} />}
            <span className="pref-actions">
              {counts.length > 0 && (
                <select value={chosen ?? ''} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : 'all')}>
                  {counts.map((n) => (
                    <option key={n} value={n}>
                      {s.newest(n)}
                    </option>
                  ))}
                  <option value="">{s.all(r.outdated)}</option>
                </select>
              )}
              <button className="btn primary" onClick={() => act(() => api.reshare(chosen))}>
                {s.go}
              </button>
              <button className="btn" title={s.dismissOutdatedHint} onClick={() => act(api.dismissReshare)}>
                {s.dismiss}
              </button>
            </span>
          </li>
        )}
      </ul>
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

function PreferenceRow({ p }: { p: Preference }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, act] = useAct();
  const save = () => {
    if (draft === null || draft.trim() === p.text) return setDraft(null);
    act(async () => {
      await api.setPreference(p.id, draft);
      setDraft(null);
    });
  };
  return (
    <li>
      {draft === null ? (
        <span className="pref-text" title={t.koordinator.edit} onClick={() => setDraft(p.text)}>
          {p.text}
        </span>
      ) : (
        <RuleEdit draft={draft} setDraft={setDraft} onEnter={save} onBlur={save} />
      )}
      <button className="pref-del" title={t.koordinator.remove} onClick={() => api.setPreference(p.id, null).catch(() => {})}>
        ✕
      </button>
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** A rule the owner writes: one of theirs, active at once, or for a repository's CLAUDE.md, which goes into its card „CLAUDE.md ergänzen“. */
function NewPreference({ repos }: { repos: RepoRef[] }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [filed, setFiled] = useState('');
  const [error, act] = useAct();
  const add = () =>
    text.trim() &&
    act(async () => {
      await api.addPreference(text.trim(), target || undefined);
      setText('');
      setFiled(target ? t.koordinator.filed(repos.find((r) => r.id === target)?.name ?? target) : '');
    });
  return (
    <div className="composer pref-new">
      <textarea
        value={text}
        rows={1}
        placeholder={t.koordinator.addPlaceholder}
        onChange={(e) => {
          setText(e.target.value);
          setFiled('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            add();
          }
        }}
      />
      <button className="btn" disabled={!text.trim()} onClick={add}>
        {t.koordinator.add}
      </button>
      <TargetPick value={target} repos={repos} onChange={setTarget} />
      {filed && <span className="hint filed">{filed}</span>}
      {error && <span className="p-error">{error}</span>}
    </div>
  );
}
