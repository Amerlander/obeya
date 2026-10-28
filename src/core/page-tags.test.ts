import { describe, expect, test } from 'bun:test';
import { outside, pageTags, parseTagLines, shownTags, tagLines, tagsOf, untagged } from './page-tags';

const vocabulary = { Area: ['Billing', 'Reports'], Audience: ['Admins', 'Customers'], Empty: [] };

describe('the tags of a page', () => {
  test('each dimension from the first layer that has it: by hand, the newest worker, the reading session', () => {
    expect(pageTags([{ Area: [] }, { Area: ['Billing'], Audience: ['Admins'] }, undefined, { Audience: ['Customers'], Plan: ['Pro'] }])).toEqual({ Area: [], Audience: ['Admins'], Plan: ['Pro'] });
  });

  test("a dimension counts as untagged without a choice, or with a value the vocabulary no longer has; an empty list is a choice", () => {
    expect(untagged({}, vocabulary)).toEqual(['Area', 'Audience']);
    expect(untagged({ Area: [], Audience: ['Admins', 'Tenants'] }, vocabulary)).toEqual(['Audience']);
    expect(untagged({ Area: [] }, undefined)).toEqual([]);
  });

  test("what a page shows and carries: the vocabulary's dimensions and values, in its order", () => {
    expect(shownTags({ Audience: ['Customers', 'Admins'], Area: [], Plan: ['Pro'] }, vocabulary)).toEqual([['Audience', ['Admins', 'Customers']]]);
    expect(tagsOf({ Audience: ['Customers', 'Tenants'], Area: [], Plan: ['Pro'] }, vocabulary)).toEqual({ Area: [], Audience: ['Customers'] });
    expect(outside({ Audience: ['Tenants'], Plan: ['Pro'] }, vocabulary)).toEqual(['Audience: Tenants', 'Plan (no such dimension)']);
  });

  test('the vocabulary as the configuration writes it, a dimension per line', () => {
    expect(parseTagLines('Area: Billing, Reports,\n\n Audience :Admins,Admins, Customers\nno colon\nEmpty:\n')).toEqual({ Area: ['Billing', 'Reports'], Audience: ['Admins', 'Customers'] });
    expect(parseTagLines(tagLines({ Area: ['Billing', 'Reports'] }))).toEqual({ Area: ['Billing', 'Reports'] });
    expect(parseTagLines('  \n')).toBeUndefined();
  });
});
