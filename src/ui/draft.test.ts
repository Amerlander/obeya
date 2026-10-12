import { expect, test } from 'bun:test';
import { cardDraft, draftOf, dropDraft, keepDrafts, updateDraft } from './draft';

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

// `keepDrafts` holds its store for the rest of the page
const s = store();

test("a card's draft outlives the page: written down per canvas as it changes, taken back by the next page", () => {
  const picks = { of: '[{"text":"Farbe?"}]', picks: [['Blau']] };
  s.setItem('obeya-drafts-shop', JSON.stringify({ [cardDraft('c9')]: { text: 'vom letzten Mal', images: ['img1'] }, [cardDraft('c5')]: { text: '', images: [], picks } }));
  keepDrafts(s, 'shop');
  expect(draftOf(cardDraft('c9'))).toMatchObject({ text: 'vom letzten Mal', images: ['img1'], uploading: 0, dictation: '' });
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
