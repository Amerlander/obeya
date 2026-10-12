import { expect, test } from 'bun:test';
import { cardDraft, draftOf, dropDraft, keepDrafts, updateDraft } from './draft';

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test("a card's draft outlives the page: written down per canvas as it changes, taken back by the next page", () => {
  const s = store();
  s.setItem('obeya-drafts-shop', JSON.stringify({ [cardDraft('c9')]: { text: 'vom letzten Mal', images: ['img1'] } }));
  keepDrafts(s, 'shop');
  expect(draftOf(cardDraft('c9'))).toMatchObject({ text: 'vom letzten Mal', images: ['img1'], uploading: 0, dictation: '' });

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
