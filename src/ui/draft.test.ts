import { expect, test } from 'bun:test';
import { appended, cardDraft, draftOf, dropDraft, giveBack, insert, keepDrafts, MIC_DRAFT, markupOf, moveImages, OBEYA_DRAFT, setMarkup, updateDraft } from './draft';

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

// `keepDrafts` holds its store for the rest of the page
const s = store();

test("a card's draft outlives the page: written down per canvas as it changes, taken back by the next page", () => {
  const picks = { of: '[{"text":"Farbe?"}]', picks: [['Blau']] };
  s.setItem('obeya-drafts-shop', JSON.stringify({ [cardDraft('c9')]: { text: 'vom letzten Mal', images: ['img1'] }, [cardDraft('c5')]: { text: '', images: [], picks } }));
  const markup = { original: 'img0', marks: [{ kind: 'frame', x: 1, y: 2, w: 30, h: 40 }] };
  s.setItem('obeya-markups-shop', JSON.stringify({ img1: markup }));
  keepDrafts(s, 'shop');
  expect(draftOf(cardDraft('c9'))).toMatchObject({ text: 'vom letzten Mal', images: ['img1'], uploading: 0, dictation: '' });
  // the marks on its screenshot come back too, apart from the original
  expect(markupOf('img1')).toEqual(markup as never);
  setMarkup('img1', null);
  // the options picked come back too, also without words beside them
  expect(draftOf(cardDraft('c5')).picks).toEqual(picks);
  updateDraft(cardDraft('c5'), { picks: { of: picks.of, picks: [[]] } });

  updateDraft(cardDraft('c1'), { text: 'Bitte den Knopf blau' });
  updateDraft('field:x', { text: 'ein Feld für sich' });
  updateDraft(cardDraft('c2'), { text: '   ' });
  expect(JSON.parse(s.getItem('obeya-drafts-shop')!)).toEqual({
    [cardDraft('c9')]: { text: 'vom letzten Mal', images: ['img1'] },
    [cardDraft('c1')]: { text: 'Bitte den Knopf blau', images: [] },
  });

  // sent: the field is empty again, and nothing is kept
  updateDraft(cardDraft('c1'), { text: '' });
  dropDraft(cardDraft('c9'));
  expect(s.getItem('obeya-drafts-shop')).toBeNull();
});

test('the options picked for a card\'s questions are written down with its draft, and go once nothing is picked', () => {
  updateDraft(cardDraft('p1'), { picks: { of: 'q', picks: [['Ja'], []] } });
  expect(JSON.parse(s.getItem('obeya-drafts-shop')!)).toEqual({ [cardDraft('p1')]: { text: '', images: [], picks: { of: 'q', picks: [['Ja'], []] } } });
  updateDraft(cardDraft('p1'), { picks: undefined });
  expect(s.getItem('obeya-drafts-shop')).toBeNull();
});

test('the marks on a screenshot are kept beside its original by the marked image, and go when taken back', () => {
  const marks = [{ kind: 'pin' as const, x: 4, y: 5 }];
  setMarkup('marked1', { original: 'orig1', marks });
  expect(markupOf('marked1')).toEqual({ original: 'orig1', marks });
  expect(JSON.parse(s.getItem('obeya-markups-shop')!)).toEqual({ marked1: { original: 'orig1', marks } });
  setMarkup('marked1', null);
  expect(markupOf('marked1')).toBeUndefined();
  expect(s.getItem('obeya-markups-shop')).toBeNull();
});

test('words taken back go into an empty field with their screenshots; a field with newer words keeps those', () => {
  const key = cardDraft('back');
  giveBack(key, 'Bitte auch Excel.', ['shot.png']);
  expect(draftOf(key)).toMatchObject({ text: 'Bitte auch Excel.', images: ['shot.png'] });
  updateDraft(key, { text: 'Etwas anderes.', images: [] });
  giveBack(key, 'Und PDF.');
  expect(draftOf(key)).toMatchObject({ text: 'Etwas anderes.', images: [] });
  dropDraft(key);
});

test("the screenshots beside the microphone go into Obeya's field after those it has, the field's words untouched", () => {
  updateDraft(MIC_DRAFT, { images: ['a.png', 'b.png'] });
  updateDraft(OBEYA_DRAFT, { text: 'Schau mal', images: ['b.png', 'c.png'] });
  moveImages(MIC_DRAFT, OBEYA_DRAFT);
  expect(draftOf(OBEYA_DRAFT)).toMatchObject({ text: 'Schau mal', images: ['b.png', 'c.png', 'a.png'] });
  expect(draftOf(MIC_DRAFT).images).toEqual([]);
  dropDraft(MIC_DRAFT);
  dropDraft(OBEYA_DRAFT);
});

test("a dropped file's path goes after the draft's words without a field on the page, parted by a space", () => {
  insert(MIC_DRAFT, '/o/files/a/Rechnung.pdf');
  expect(draftOf(MIC_DRAFT).text).toBe('/o/files/a/Rechnung.pdf');
  insert(MIC_DRAFT, '/o/files/b/log.txt');
  expect(draftOf(MIC_DRAFT).text).toBe('/o/files/a/Rechnung.pdf /o/files/b/log.txt');
  updateDraft(MIC_DRAFT, { text: '' });
  expect(appended('Schau hier: ', '/x.pdf')).toBe('Schau hier: /x.pdf');
  expect(appended('Schau hier:', '/x.pdf')).toBe('Schau hier: /x.pdf');
  expect(appended('', '/x.pdf')).toBe('/x.pdf');
});
