// The phone view: on a phone the page shows, instead of the canvas, what waits for the owner across
// every canvas („Für dich“) and what runs („Läuft“); Obeya's conversation is a panel of its own that
// comes up from below. A card opens full screen with the canvas's own detail view (its conversation,
// answer options, demo, approve buttons), and Back returns to the list. The microphone is held by touch; Enter breaks the line, only Send sends;
// what was typed but not sent survives a reload. It holds one WebSocket per canvas.

import { useEffect, useMemo, useRef, useState } from 'react';
import { type CanvasInfo, type CanvasSnapshot, type CardPatch, type Item, needsYou, unreadAnswers } from '../core/types';
import { api, beforeReload, onNotice, setCanvas, useCanvas, type Where } from './api';
import { enterBreaksLines } from './composer';
import { type ActDone, Detail, type Pending } from './detail';
import { cardDraft, fieldOn, focusedDraft, keepDrafts, MIC_DRAFT, obeyaDraft } from './draft';
import { KoordinatorTalk } from './koordinator';
import { Sign } from './logo';
import { Notify, registerWorker } from './notify';
import { plain } from './markdown';
import { Cards } from './message';
import type { Reply } from './reply';
import { CardFace, cardClass, shownState, TalkIcon } from './parts';
import { videoOf } from './spot';
import { clock, failText, forTouch, shortDay, t } from './strings';
import { tellers, useAck, voiceTarget } from './tell';
import { HoldToTalk, PushToTalk, ToldList, usePushToTalk, useTold } from './voice';

/**
 * Whether the page shows the phone view: on a phone, which has a coarse pointer and a short side
 * under 600 px whichever way it is held (a tablet and a narrow window at the desk keep the canvas).
 * `?view=phone` or `?view=canvas` in the address decides instead.
 */
export function phoneView(): boolean {
  const asked = new URLSearchParams(location.search).get('view');
  if (asked === 'phone' || asked === 'canvas') return asked === 'phone';
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

/** The phone view keeps its drafts apart from any canvas's: it shows every canvas. */
const DRAFTS = '@phone';
/** The canvas whose Obeya the conversation at the bottom is with, as the owner last picked it. */
const OBEYA_CANVAS = 'obeya-phone-canvas';
/** How long the server may not answer before the view says so: a phone back from its lock screen reconnects within this. */
const QUIET_MS = 3000;

/** The address with `card` open (or none) and Obeya's panel open or not, keeping what else it holds (`?view=phone`, say). */
function addressWith({ card, talk }: { card: string | null; talk: boolean }) {
  const q = new URLSearchParams(location.search);
  if (card) q.set('card', card);
  else q.delete('card');
  if (talk) q.set('talk', '');
  else q.delete('talk');
  const s = q.toString().replace(/=(&|$)/g, '$1');
  return `${location.pathname}${s ? `?${s}` : ''}`;
}
const cardInAddress = () => new URLSearchParams(location.search).get('card');
const talkInAddress = () => new URLSearchParams(location.search).has('talk');
/** How far the panel's top is dragged down before letting go closes it (a quick flick closes it sooner). */
const DRAG_CLOSES = 110;

/** When something began: the time today, else the day. */
const when = (iso: string | number) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : shortDay(iso));

export function Phone({ canvases: loaded }: { canvases: CanvasInfo[] }) {
  keepDrafts(sessionStorage, DRAFTS);
  useState(() => {
    forTouch();
    enterBreaksLines();
  });
  const [canvases, setCanvases] = useState(loaded);
  // the canvases it last had, while the server did not answer: the list the server sends once it does
  useEffect(() => setCanvases(loaded), [loaded]);
  const [snaps, setSnaps] = useState<Record<string, CanvasSnapshot>>({});
  const [offline, setOffline] = useState<Record<string, number | null>>({});
  const feed = (id: string, live: ReturnType<typeof useCanvas>) => {
    if (live.snapshot) setSnaps((s) => (s[id] === live.snapshot ? s : { ...s, [id]: live.snapshot! }));
    setOffline((o) => (o[id] === live.offlineSince ? o : { ...o, [id]: live.offlineSince }));
    if (live.canvases) setCanvases(live.canvases);
  };

  // ---------------------------------------------------------------- what is open
  const [open, setOpenState] = useState<string | null>(cardInAddress);
  const openRef = useRef(open);
  openRef.current = open;
  // Obeya's conversation, a panel over the list
  const [talk, setTalk] = useState(talkInAddress);
  const talkRef = useRef(talk);
  talkRef.current = talk;
  // opening a card or the panel is a step in the browser's history: its Back (or the swipe) closes it
  // again; the steps this page pushed, the latest last
  const pushed = useRef<('card' | 'talk')[]>([]);
  const step = (what: 'card' | 'talk', to: { card: string | null; talk: boolean }) => {
    history.pushState(null, '', addressWith(to));
    pushed.current.push(what);
  };
  /** Back from `what`: the browser's own step back where this page pushed it, else the address without it. */
  const stepBack = (what: 'card' | 'talk', to: { card: string | null; talk: boolean }) => {
    if (pushed.current.at(-1) === what) return history.back();
    history.replaceState(null, '', addressWith(to));
    if (what === 'card') setOpenState(null);
    else setTalk(false);
  };
  const openId = (id: string) => {
    if (openRef.current === id) return;
    if (!openRef.current) homeScroll.current = homeRef.current?.scrollTop ?? 0;
    if (openRef.current) history.replaceState(null, '', addressWith({ card: id, talk: talkRef.current }));
    else step('card', { card: id, talk: talkRef.current });
    setOpenState(id);
  };
  const openCard = (i: Item) => openId(i.id);
  const back = () => {
    if (!openRef.current) return;
    flushEdit().catch(console.error);
    stepBack('card', { card: null, talk: talkRef.current });
  };
  const openTalk = () => {
    if (talkRef.current || openRef.current) return;
    step('talk', { card: null, talk: true });
    setTalk(true);
  };
  const closeTalk = () => talkRef.current && !openRef.current && stepBack('talk', { card: null, talk: false });
  /** Back to the list, from a card and the panel alike. */
  const home = () => {
    flushEdit().catch(console.error);
    const n = pushed.current.length;
    pushed.current = [];
    if (n) return history.go(-n);
    history.replaceState(null, '', addressWith({ card: null, talk: false }));
    setOpenState(null);
    setTalk(false);
  };
  // a tapped push: its card (or „Für dich“ for several) in the app that is open already
  useEffect(() => {
    registerWorker();
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const tapped = (e: MessageEvent) => {
      if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
      const card = new URL(e.data.url, location.href).searchParams.get('card');
      if (card) openId(card);
      else home();
    };
    sw.addEventListener('message', tapped);
    return () => sw.removeEventListener('message', tapped);
  }, []);
  useEffect(() => {
    const pop = () => {
      flushEdit().catch(console.error);
      pushed.current.pop();
      setOpenState(cardInAddress());
      setTalk(talkInAddress());
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  // the list keeps where it was scrolled to while a card is open
  const homeRef = useRef<HTMLDivElement>(null);
  const homeScroll = useRef(0);
  useEffect(() => {
    if (!open && homeRef.current) homeRef.current.scrollTop = homeScroll.current;
  }, [open]);

  // ---------------------------------------------------------------- the cards
  const ordered = canvases.filter((c) => snaps[c.id]);
  const all = useMemo(() => ordered.flatMap((c) => snaps[c.id]!.items.map((item) => ({ item, canvas: c }))), [snaps, canvases]);
  const allRef = useRef(all);
  allRef.current = all;
  const byId = (id: string) => allRef.current.find((x) => x.item.id === id)?.item;
  // approved cards the server is still landing: they need the owner no longer
  const [underway, setUnderway] = useState<string[]>([]);
  useEffect(() => setUnderway((u) => u.filter((id) => byId(id)?.state === 'waiting')), [snaps]);
  const opened = open ? all.find((x) => x.item.id === open) : undefined;

  // the canvas whose Obeya is spoken to without a card open
  const [obeyaCanvas, setObeyaCanvasState] = useState(() => {
    const wanted = new URLSearchParams(location.search).get('c') ?? localStorage.getItem(OBEYA_CANVAS);
    return (canvases.find((c) => c.id === wanted) ?? canvases[0]!).id;
  });
  const obeyaId = canvases.some((c) => c.id === obeyaCanvas) ? obeyaCanvas : canvases[0]!.id;
  const obeyaRef = useRef(obeyaId);
  obeyaRef.current = obeyaId;
  const setObeyaCanvas = (id: string) => {
    setObeyaCanvasState(id);
    try {
      localStorage.setItem(OBEYA_CANVAS, id);
    } catch {}
  };
  // every call goes to the API of the canvas in view: the open card's, else Obeya's
  setCanvas(opened?.canvas.id ?? obeyaId);

  // ---------------------------------------------------------------- edits of the open card
  const edit = useRef<{ id: string; patch: CardPatch; timer?: ReturnType<typeof setTimeout> } | null>(null);
  /** Saves what was typed into the open card; actions on it wait for this. */
  function flushEdit(): Promise<void> {
    const e = edit.current;
    if (!e) return Promise.resolve();
    clearTimeout(e.timer);
    edit.current = null;
    return Object.keys(e.patch).length ? api.patch(e.id, e.patch) : Promise.resolve();
  }
  const onEdit = (p: CardPatch) => {
    const id = openRef.current;
    if (!id) return;
    if (edit.current?.id !== id) flushEdit().catch(console.error);
    const e = (edit.current ??= { id, patch: {} });
    Object.assign(e.patch, p);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flushEdit().catch(console.error), 400);
  };
  useEffect(() => beforeReload(() => void flushEdit().catch(console.error)), []);

  // ---------------------------------------------------------------- voice and confirmations
  const { showAck, showWait, fail, line: ackLine } = useAck();
  const told = useTold(() => {});
  const { tellAbout, tellTyped } = tellers(byId, told, fail, () => undefined);
  const where = (): Where => (openRef.current ? { card: openRef.current } : null);
  /** The draft of the field that speaks to `target`: the open card's, or the one under Obeya's conversation. */
  const draftFor = (target: Where) => (target && 'card' in target ? cardDraft(target.card) : obeyaDraft(obeyaRef.current));
  const fieldFor = (target: Where) => {
    const key = draftFor(target);
    return fieldOn(key) ? key : MIC_DRAFT;
  };
  const ptt = usePushToTalk(where, fieldFor, tellAbout, (h) => showAck(h.confirm), () => undefined);
  const pttRef = useRef(ptt);
  pttRef.current = ptt;
  /** The open card's demo video while the microphone is held: it pauses, and plays on after unless the words went into a field. */
  const pressing = useRef<{ video: HTMLVideoElement | null; playing: boolean; dictating: boolean } | null>(null);
  const press = () => {
    const id = openRef.current;
    const video = id ? (videoOf(id) ?? document.querySelector<HTMLVideoElement>('.card-sheet video')) : null;
    pressing.current = { video, playing: !!video && !video.paused, dictating: !!focusedDraft() };
    video?.pause();
    pttRef.current.start();
  };
  useEffect(() => {
    // a finger lifted, or taken over by the browser, ends the recording wherever it is
    const release = () => {
      const p = pressing.current;
      pressing.current = null;
      pttRef.current.stop();
      if (p?.video && p.playing && !p.dictating) p.video.play().catch(() => {});
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    return () => {
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
    };
  }, []);
  useEffect(
    () =>
      onNotice((n) => {
        const i = n.cardId ? byId(n.cardId) : undefined;
        told.show(i ? { id: i.id, title: plain(i.title) } : undefined, { confirm: n.text, ...(n.token ? { token: n.token } : {}), ...(n.undoMs ? { undoMs: n.undoMs } : {}) });
      }),
    [],
  );
  // Esc closes the open card, as Back does (a keyboard at the phone, or the view tried at the desk)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.lightbox')) return;
      if (openRef.current) back();
      else closeTalk();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  /** After an action on the open card: back to the list, with the confirmation; one the server is still at says so until it answered. */
  function onDone(d: ActDone, p?: Pending) {
    if (!d.close) return;
    back();
    if (!p || !d.pending) return showAck(d.ack, d.undo);
    const card = p.card;
    setUnderway((u) => [...u, card]);
    showWait(`${d.pending.charAt(0).toUpperCase()}${d.pending.slice(1)}`);
    p.answered.then(
      () => showAck(d.ack, d.undo),
      (e) => {
        setUnderway((u) => u.filter((id) => id !== card));
        showAck(t.cardError(p.title, failText(e)));
      },
    );
  }
  async function deleteOpen() {
    const i = opened?.item;
    if (!i) return;
    if (edit.current) clearTimeout(edit.current.timer);
    edit.current = null;
    back();
    try {
      await api.remove(i.id);
      showAck(t.deleted(plain(i.title)), () => api.restore(i.id));
    } catch (e) {
      fail(e);
    }
  }

  // ---------------------------------------------------------------- the machine not answering
  const quietSince = Object.values(offline).reduce<number | null>((min, x) => (x === null ? min : min === null ? x : Math.min(min, x)), null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (quietSince === null) return;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(0, quietSince + QUIET_MS - Date.now()) + 50);
    return () => clearTimeout(h);
  }, [quietSince]);
  const quiet = quietSince !== null && Date.now() - quietSince >= QUIET_MS;

  const feeds = canvases.map((c) => <Feed key={c.id} id={c.id} onChange={feed} />);
  const several = canvases.length > 1;
  const banner = quiet && (
    <div className="ph-quiet" role="status">
      <b>{t.phone.notAnswering(when(quietSince!))}</b>
      <span>{t.phone.notAnsweringWhy}</span>
    </div>
  );
  const voice = (
    <>
      <div id="acks">
        <ToldList told={told.told} open={open ?? undefined} onUndo={told.undo} />
        {ackLine}
      </div>
      <PushToTalk
        phase={ptt.phase}
        level={ptt.level}
        flat={ptt.flat}
        target={voiceTarget(open ? { type: 'card', item: opened?.item } : null)}
        field={draftFor(where())}
        onDown={press}
      />
    </>
  );

  if (open) {
    const c = opened?.canvas;
    const items = c ? snaps[c.id]!.items : [];
    const i = opened?.item;
    return (
      <HoldToTalk.Provider value={press}>
        {feeds}
        <div id="ph-card" className="ph-view" style={i ? ({ '--c': `var(--${shownState(i)})` } as React.CSSProperties) : undefined}>
          <header className="ph-bar">
            <button className="ph-back" onClick={back}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.phone.back}
            </button>
            {c && several && <span className="ph-canvas">{c.name}</span>}
          </header>
          {banner}
          <div className="card-sheet ph-sheet">
            {i && c ? (
              <Cards.Provider value={{ items, open: openCard }}>
                <Detail
                  key={i.id}
                  item={i}
                  all={items}
                  repos={snaps[c.id]!.canvas.repos}
                  parent={i.parent ? items.find((x) => x.id === i.parent) : undefined}
                  from={i.from ? items.find((x) => x.id === i.from) : undefined}
                  onEdit={onEdit}
                  flush={flushEdit}
                  onDelete={() => void deleteOpen()}
                  onDone={onDone}
                  onTell={(text, images, field, replyTo) => void tellTyped(text, images, { card: i.id }, field, replyTo)}
                />
              </Cards.Provider>
            ) : (
              // the snapshots are still on their way, or the card went (archived, deleted)
              Object.keys(snaps).length === canvases.length && <p className="hint">{t.phone.gone}</p>
            )}
          </div>
        </div>
        {voice}
      </HoldToTalk.Provider>
    );
  }

  const isUnderway = (id: string) => underway.includes(id);
  const obeyaSnap = snaps[obeyaId];
  const unreadOf = (id: string) => (snaps[id] ? unreadAnswers(snaps[id].talk) : 0);
  const unread = ordered.reduce((n, c) => n + unreadOf(c.id), 0);
  /** The panel, with the conversation an answer waits unread in when the one last picked has none. */
  const openTalkNewest = () => {
    const waiting = ordered.find((c) => unreadOf(c.id));
    if (!unreadOf(obeyaId) && waiting) setObeyaCanvas(waiting.id);
    openTalk();
  };
  /** Closes the open panel as dragging it down does, sliding out. */
  const leaveTalk = useRef<(() => void) | null>(null);
  // the panel sliding out: the button offers it again at once
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!talk) setClosing(false);
  }, [talk]);
  const shown = talk && !closing;
  return (
    <HoldToTalk.Provider value={press}>
      {feeds}
      <div id="ph-home" className="ph-view" ref={homeRef}>
        <header className="ph-bar ph-home">
          <Sign size={26} />
          <span className="ph-word">Obeya</span>
        </header>
        {banner}
        <Notify />
        <section className="ph-section">
          <h2>{t.phone.forYou}</h2>
          <ForYou
            canvases={ordered}
            snaps={snaps}
            several={several}
            underway={isUnderway}
            onOpen={openCard}
            onObeya={(id) => {
              setObeyaCanvas(id);
              openTalk();
            }}
          />
        </section>
        <section className="ph-section">
          <h2>{t.phone.running}</h2>
          {/* nothing known yet (the server has not answered since the page loaded): no claim that nothing runs */}
          {ordered.length > 0 && <Running entries={all.filter(({ item }) => runs(item))} several={several} onOpen={openCard} />}
        </section>
      </div>
      {talk && (
        <TalkPanel
          canvas={obeyaId}
          banner={banner}
          snap={obeyaSnap}
          onClose={closeTalk}
          leave={leaveTalk}
          onLeave={() => setClosing(true)}
          onOpen={openCard}
          onTell={(text, images, replyTo) => void tellTyped(text, images, null, undefined, replyTo)}
        />
      )}
      {/* left of the microphone, in reach of the thumb, as the canvas's top bar has it: opens the panel, and closes it while it is open (inverted then) */}
      <button
        className={shown ? 'pill kpill talk-pill ph-talk-open on' : 'pill kpill talk-pill ph-talk-open'}
        aria-expanded={shown}
        aria-label={shown ? t.phone.closeTalk : t.phone.talkTitle}
        onClick={() => (talk ? leaveTalk.current?.() : openTalkNewest())}
      >
        <TalkIcon />
        {!shown && unread > 0 && (
          <span className="n unread" title={t.koordinator.unreadCount(unread)}>
            {unread}
          </span>
        )}
      </button>
      {/* right of the microphone, with several canvases: whose Obeya the microphone and the panel speak to */}
      {several && (
        <label className="pill ph-canvas-pick">
          <span className="name">{canvases.find((c) => c.id === obeyaId)?.name}</span>
          <span className="hint">▾</span>
          <select value={obeyaId} aria-label={t.phone.canvas} onChange={(e) => setObeyaCanvas(e.target.value)}>
            {canvases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {voice}
    </HoldToTalk.Provider>
  );
}

/** One canvas's live snapshot, handed up as it changes. */
function Feed({ id, onChange }: { id: string; onChange: (id: string, live: ReturnType<typeof useCanvas>) => void }) {
  const live = useCanvas(id);
  useEffect(() => onChange(id, live), [live.snapshot, live.offlineSince, live.canvases]);
  return null;
}

/** A card an agent or Obeya is at (working on it, landing it, finding it a turn in the queue), and that waits for nobody. */
const runs = (i: Item) =>
  !needsYou(i) && (i.state === 'working' || !!i.finishing || !!i.landing || !!i.queue || (i.state === 'inPr' && !!i.pr) || !!i.idea?.thinking || !!i.thread?.thinking);

/** What waits for the owner, canvas by canvas in the switcher's order and within a canvas in Tab's order; Obeya where an answer waits unread. */
function ForYou({
  canvases,
  snaps,
  several,
  underway,
  onOpen,
  onObeya,
}: {
  canvases: CanvasInfo[];
  snaps: Record<string, CanvasSnapshot>;
  several: boolean;
  underway: (id: string) => boolean;
  onOpen: (i: Item) => void;
  onObeya: (canvas: string) => void;
}) {
  const rows = canvases.flatMap((c) => {
    const s = snaps[c.id]!;
    const cards = s.items.filter((i) => needsYou(i) && !underway(i.id));
    const unread = unreadAnswers(s.talk) ? s.talk.filter((x) => x.unread) : [];
    return [
      ...cards.map((i) => (
        <li key={i.id}>
          <button className={`${cardClass(i)} ph-card`} onClick={() => onOpen(i)}>
            <CardFace item={i} where={several ? c.name : undefined} since={i.waitingSince ? t.phone.since(when(i.waitingSince)) : undefined} />
          </button>
        </li>
      )),
      ...(unread.length
        ? [
            <li key={`obeya:${c.id}`}>
              <button className="card s-working ph-card" onClick={() => onObeya(c.id)}>
                <div className="kind">
                  <span>{[several && c.name, t.koordinator.title].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="ttl">{plain(unread.at(-1)!.question ?? unread.at(-1)!.said)}</div>
                <div className="state">
                  {t.phone.obeyaAnswered}
                  <span className="since"> · {t.phone.since(when(unread.at(-1)!.at))}</span>
                </div>
              </button>
            </li>,
          ]
        : []),
    ];
  });
  if (!canvases.length) return null;
  return rows.length ? <ul className="ph-list">{rows}</ul> : <p className="ph-none">{t.phone.nothingWaits}</p>;
}

/** The cards at work, each with its status line, as their cards on the canvas show them. */
function Running({ entries, several, onOpen }: { entries: { item: Item; canvas: CanvasInfo }[]; several: boolean; onOpen: (i: Item) => void }) {
  if (!entries.length) return <p className="ph-none">{t.phone.nothingRuns}</p>;
  return (
    <ul className="ph-list">
      {entries.map(({ item: i, canvas: c }) => (
        <li key={i.id}>
          <button className={`${cardClass(i)} ph-card`} onClick={() => onOpen(i)}>
            <CardFace item={i} where={several ? c.name : undefined} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Obeya's conversation of one canvas as a panel over the list, from below: the conversation is the
 * only thing in it that scrolls, the field stands under it and the microphone below that. Its answers
 * count as read while it is open. Dragging its top down (or the button under it, or Back) closes it.
 */
function TalkPanel({
  canvas,
  banner,
  snap,
  onClose,
  leave: leaveRef,
  onLeave,
  onOpen,
  onTell,
}: {
  canvas: string;
  banner: React.ReactNode;
  snap: CanvasSnapshot | undefined;
  onClose: () => void;
  /** Where the panel puts its way of closing, for the button beside the microphone. */
  leave: React.RefObject<(() => void) | null>;
  /** The panel starts sliding out. */
  onLeave: () => void;
  onOpen: (i: Item) => void;
  onTell: (text: string, images?: string[], replyTo?: Reply['to']) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ y: number; at: number; dy: number } | null>(null);
  const gone = useRef(false);
  const leave = () => {
    if (gone.current) return;
    gone.current = true;
    onLeave();
    setLeaving(true);
    setTimeout(onClose, 200);
  };
  leaveRef.current = leave;
  // the panel takes the part of the screen the keyboard leaves, so the field stays above it
  useEffect(() => {
    const vv = window.visualViewport;
    const el = panel.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.setProperty('--vvh', `${vv.height}px`);
      el.style.setProperty('--vvt', `${vv.offsetTop}px`);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);
  // the confirmations above the microphone stand above the field while the panel is open
  useEffect(() => {
    const field = panel.current?.querySelector('.composer');
    if (!field) return;
    const root = document.documentElement;
    const keep = new ResizeObserver(() => root.style.setProperty('--ph-field', `${field.getBoundingClientRect().height}px`));
    keep.observe(field);
    return () => {
      keep.disconnect();
      root.style.removeProperty('--ph-field');
    };
  }, [snap === undefined, canvas]);
  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button, select')) return;
    drag.current = { y: e.clientY, at: Date.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    setDy(d.dy);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const flick = d.dy > 30 && d.dy / Math.max(1, Date.now() - d.at) > 0.6;
    if (d.dy > DRAG_CLOSES || flick) leave();
    else setDy(0);
  };
  const style = leaving ? undefined : dy ? { transform: `translateY(${dy}px)` } : undefined;
  return (
    <div id="ph-talk" className={['ph-view ph-panel', leaving && 'leaving', drag.current && 'dragging'].filter(Boolean).join(' ')} ref={panel} style={style} role="dialog" aria-label={t.phone.talkTitle}>
      <header className="ph-bar ph-grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="ph-word">{t.koordinator.title}</span>
      </header>
      {banner}
      {snap && (
        <div className="ph-talk" key={canvas}>
          <KoordinatorTalk on talk={snap.talk} items={snap.items} onOpen={onOpen} onTell={onTell} draft={obeyaDraft(canvas)} />
        </div>
      )}
    </div>
  );
}
