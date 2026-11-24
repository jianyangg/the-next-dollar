import { describe, expect, it } from 'vitest';
import { buildTemplatePitch } from './template.ts';
import { extractNumbers, validateSellerReply } from './validator.ts';
import { GOOD_LEASE_ANSWER, GOOD_PITCH, PERSONA, PUBLIC_DEAL, json } from './testSupport.ts';

const pitch = (text: string) => validateSellerReply(json(text), PUBLIC_DEAL, 'pitch');
const answer = (text: string) => validateSellerReply(json(text), PUBLIC_DEAL, 'answer');
const reasonOf = (v: ReturnType<typeof pitch>) => (v.ok ? 'accepted' : v.reason);

describe('validator: shape (A7.1)', () => {
  it('accepts a good pitch and a good answer', () => {
    expect(pitch(GOOD_PITCH)).toEqual({ ok: true, text: GOOD_PITCH });
    expect(answer(GOOD_LEASE_ANSWER)).toEqual({ ok: true, text: GOOD_LEASE_ANSWER });
  });

  it('rejects non-JSON, wrong shape and empty text', () => {
    expect(reasonOf(validateSellerReply('I would love to sell you this stand', PUBLIC_DEAL, 'pitch'))).toBe('bad-json');
    expect(reasonOf(validateSellerReply('{"message":"hi"}', PUBLIC_DEAL, 'pitch'))).toBe('bad-shape');
    expect(reasonOf(validateSellerReply('{"text":42}', PUBLIC_DEAL, 'pitch'))).toBe('bad-shape');
    expect(reasonOf(pitch('   '))).toBe('empty');
  });

  it('rejects a refusal, whether plain text or inside the JSON', () => {
    expect(reasonOf(validateSellerReply("I'm sorry, I can't help with that.", PUBLIC_DEAL, 'answer'))).toBe('bad-json');
    expect(reasonOf(answer("I'm sorry, but I can't help with that request."))).toBe('refusal');
    expect(reasonOf(answer('As an AI language model I cannot do that.'))).toBe('refusal');
  });

  it('rejects a 200-word reply and accepts exactly 80 words', () => {
    expect(reasonOf(answer(Array(200).fill('great').join(' ')))).toBe('too-long');
    expect(answer(Array(80).fill('great').join(' ')).ok).toBe(true);
    expect(reasonOf(answer(Array(81).fill('great').join(' ')))).toBe('too-long');
  });
});

describe('validator: numbers (A7.2)', () => {
  it('rejects an invented number ($18) and a number close to a real one ($17)', () => {
    expect(reasonOf(pitch('Park Corner stand, asking $60. Sales hit $18 a day.'))).toBe('number-not-in-books');
    expect(reasonOf(pitch('Sales reached $17 a day.'))).toBe('number-not-in-books');
  });

  it('rejects a derived figure that is true but not printed (a 3-period total of 45)', () => {
    const v = pitch('Over three periods I sold $45 of lemonade.');
    expect(v).toMatchObject({ ok: false, reason: 'number-not-in-books', detail: '45' });
  });

  it('accepts every figure that is printed: asking price, book cells and off-book figures', () => {
    // 14,15,16 sales; 5 lemons; 0 wage; 3 rent; 6,7,8 profit; 60 price; 4 from the lease fact.
    expect(answer('$60, $14, $15, $16, $5, $0, $3, $6, $7, $8 and 4 days.').ok).toBe(true);
  });

  it('catches digits in any form: commas, decimals, percent, days, ordinals, full-width digits', () => {
    expect(extractNumbers('$1,000 and 14.50 and 5% and 3 days and 4th and １８')).toEqual([1000, 14.5, 5, 3, 4, 18]);
  });

  it('catches spelled-out numbers except plain "one"', () => {
    expect(extractNumbers('seventeen, twenty-one, thirty two, a dozen, one of the best')).toEqual([21, 32, 17, 12]);
    expect(reasonOf(answer('I sold seventeen cups a day.'))).toBe('number-not-in-books');
    expect(answer('Fourteen, fifteen, sixteen dollars a day.').ok).toBe(true);
  });

  it('DOCUMENTED GAP: the unit is not checked ("5 days" passes because $5 is a figure)', () => {
    expect(answer('The seller has been here 5 days.').ok).toBe(true);
  });
});

describe('validator: pitch-only volunteer guard (A7.3)', () => {
  it('rejects a pitch that mentions the lease, the staffing arrangement or the move', () => {
    expect(reasonOf(pitch('Great corner. The lease renews soon.'))).toBe('volunteered-off-book');
    expect(reasonOf(pitch('I run it myself, so there is no manager cost.'))).toBe('volunteered-off-book');
    expect(reasonOf(pitch('I am moving to Brooklyn next week.'))).toBe('volunteered-off-book');
  });

  it('rejects a pitch that uses a figure found only in an off-book fact (the 4 and the 5)', () => {
    // 5 also appears as the lemons cost, so only the lease figure 4 identifies the fact.
    expect(reasonOf(pitch('A solid stand, ready in 4 days.'))).toBe('volunteered-off-book');
  });

  it('is NOT applied to answers: the same disclosures pass when the player asked', () => {
    expect(answer('The lease renews in 4 days.').ok).toBe(true);
    expect(answer("I'm moving to Brooklyn next week.").ok).toBe(true);
    expect(answer('I run it myself, so manager pay is $0.').ok).toBe(true);
  });

  it('DOCUMENTED GAP: a paraphrase with none of the fact words slips through', () => {
    expect(pitch('Big changes are coming for me at the end of the month, so this is a rare chance.').ok).toBe(true);
  });
});

describe('validator: banned phrases (A7.4)', () => {
  it.each([
    ['I can offer a discount if you bid today.', 'discount'],
    ['The price is negotiable.', 'negotiable'],
    ['I could go lower for the right buyer.', 'lower'],
    ["Honestly, $60 is my lowest.", 'lowest'],
    ['Returns are guaranteed.', 'guaranteed'],
    ["You'll double your money.", 'double'],
    ['Other buyers are interested too.', 'other buyers'],
    ['This is the best stand in the game.', 'the game'],
  ])('rejects "%s"', (text) => {
    expect(reasonOf(answer(text))).toBe('banned-phrase');
  });
});

describe('validator: order of checks', () => {
  it('reports the number problem before the banned phrase when both exist', () => {
    expect(reasonOf(answer('A discount to $18!'))).toBe('number-not-in-books');
  });
});

describe('template pitch (A8)', () => {
  it('uses only real figures and always passes the real validator, for many deal ids', () => {
    for (let i = 0; i < 200; i++) {
      const deal = { ...PUBLIC_DEAL, id: `deal-${i}` };
      const text = buildTemplatePitch(deal, PERSONA);
      const verdict = validateSellerReply(json(text), deal, 'pitch');
      expect(verdict, text).toEqual({ ok: true, text });
    }
  });

  it('is deterministic for a deal id and never names the weak spots', () => {
    const a = buildTemplatePitch(PUBLIC_DEAL, PERSONA);
    expect(buildTemplatePitch(PUBLIC_DEAL, PERSONA)).toBe(a);
    expect(a).not.toMatch(/manager|wage|lease|renew|brooklyn|rent/i);
    expect(a).toContain('$60');
  });
});
