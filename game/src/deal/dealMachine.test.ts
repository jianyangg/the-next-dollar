import { describe, expect, it } from 'vitest';
import { createActor, fromPromise, waitFor } from 'xstate';
import type { PublicDealView } from '../core/deal';
import { CENTRAL_PARK_DEAL, resolveSealedBid, toPublicView } from '../core/deal';
import { createInitialState, type SliceState } from '../core/sliceModel';
import { canAsk, dealMachine, type BidVerdict, type QaEntry, MAX_QUESTION_CHARS, questionsLeft } from './dealMachine';

const publicDeal = toPublicView(CENTRAL_PARK_DEAL);
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Opts {
  pitchFails?: boolean;
  questionsEnabled?: boolean;
  failAnswers?: boolean;
  /** Holds the answer until resolved; lets a test observe the `answering` state. */
  gate?: Promise<void>;
  cash?: number;
}

function start(o: Opts = {}) {
  // The live game state stays outside the machine, as in production.
  let game: SliceState = { ...createInitialState(), cash: o.cash ?? 100 };
  const machine = dealMachine.provide({
    actors: {
      fetchPitch: fromPromise(async () => {
        if (o.pitchFails) throw new Error('down');
        return { text: 'Great stand!', questionsEnabled: o.questionsEnabled ?? true };
      }),
      askSeller: fromPromise(async ({ input }: { input: { deal: PublicDealView; history: QaEntry[]; question: string } }) => {
        await o.gate;
        if (o.failAnswers) throw new Error('boom');
        return { text: `answer to ${input.question}` };
      }),
      resolveBid: fromPromise(async ({ input }: { input: { bid: number } }) => {
        const r = resolveSealedBid(game, CENTRAL_PARK_DEAL, input.bid);
        if (r.kind === 'won' || r.kind === 'rejected') game = r.state;
        return r;
      }),
    },
  });
  const actor = createActor(machine, { input: { deal: publicDeal } });
  actor.start();
  return { actor, game: () => game };
}

async function ready(o?: Opts) {
  const h = start(o);
  await waitFor(h.actor, (s) => s.matches('open'));
  return h;
}

async function ask(actor: ReturnType<typeof start>['actor'], question: string) {
  actor.send({ type: 'ASK', question });
  await waitFor(actor, (s) => s.matches({ open: 'idle' }));
}

describe('pitch', () => {
  it('opens with the pitch on success', async () => {
    const { actor } = await ready();
    const c = actor.getSnapshot().context;
    expect(c.pitch).toBe('Great stand!');
    expect(c.pitchError).toBe(false);
    expect(canAsk(actor.getSnapshot())).toBe(true);
  });
  it('opens with pitchError and no invented text on failure', async () => {
    const { actor } = await ready({ pitchFails: true });
    const s = actor.getSnapshot();
    expect(s.context.pitch).toBeNull();
    expect(s.context.pitchError).toBe(true);
    expect(canAsk(s)).toBe(false);
  });
  it('respects questionsEnabled=false', async () => {
    const { actor } = await ready({ questionsEnabled: false });
    actor.send({ type: 'ASK', question: 'hi' });
    expect(actor.getSnapshot().context.qa).toHaveLength(0);
  });
});

describe('questions', () => {
  it('answers three, ignores the fourth', async () => {
    const { actor } = await ready();
    for (const q of ['a', 'b', 'c']) await ask(actor, q);
    expect(actor.getSnapshot().context.qa.map((e) => e.a)).toEqual(['answer to a', 'answer to b', 'answer to c']);
    expect(questionsLeft(actor.getSnapshot())).toBe(0);
    expect(canAsk(actor.getSnapshot())).toBe(false);
    actor.send({ type: 'ASK', question: 'd' });
    expect(actor.getSnapshot().matches({ open: 'idle' })).toBe(true);
    expect(actor.getSnapshot().context.qa).toHaveLength(3);
  });
  it('ignores 201-char, empty and whitespace questions; accepts exactly 200', async () => {
    const { actor } = await ready();
    for (const q of ['x'.repeat(MAX_QUESTION_CHARS + 1), '', '   \n ']) {
      actor.send({ type: 'ASK', question: q });
      expect(actor.getSnapshot().matches({ open: 'idle' })).toBe(true);
    }
    expect(actor.getSnapshot().context.qa).toHaveLength(0);
    await ask(actor, 'x'.repeat(MAX_QUESTION_CHARS));
    expect(actor.getSnapshot().context.qa).toHaveLength(1);
  });
  it('ignores ASK and SUBMIT_BID while answering', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { actor } = await ready({ gate });
    actor.send({ type: 'ASK', question: 'first' });
    expect(actor.getSnapshot().matches({ open: 'answering' })).toBe(true);
    actor.send({ type: 'ASK', question: 'second' });
    actor.send({ type: 'SUBMIT_BID', bid: 50 });
    expect(actor.getSnapshot().matches({ open: 'answering' })).toBe(true);
    release();
    await waitFor(actor, (s) => s.matches({ open: 'idle' }));
    expect(actor.getSnapshot().context.qa).toHaveLength(1);
    expect(actor.getSnapshot().context.bid).toBeUndefined();
  });
  it('records a failed answer with error and counts it toward the limit', async () => {
    const { actor } = await ready({ failAnswers: true });
    await ask(actor, 'q1');
    expect(actor.getSnapshot().context.qa).toEqual([{ q: 'q1', a: null, error: true }]);
    expect(questionsLeft(actor.getSnapshot())).toBe(2);
    await ask(actor, 'q2');
    await ask(actor, 'q3');
    expect(canAsk(actor.getSnapshot())).toBe(false);
  });
});

describe('sealed bid (resolveSealedBid, reservation 42, ask 60)', () => {
  it('bid above reservation wins, applies game state, is final', async () => {
    const h = await ready();
    h.actor.send({ type: 'SUBMIT_BID', bid: 50 });
    await waitFor(h.actor, (s) => s.status === 'done');
    expect(h.actor.getSnapshot().value).toBe('won');
    expect(h.actor.getSnapshot().context.outcome).toBe('won');
    expect(h.actor.getSnapshot().output).toEqual({ outcome: 'won', bid: 50 });
    expect(h.game().cash).toBe(50);
    expect(h.game().ownedStands).toBe(createInitialState().ownedStands + 1);
  });
  it('bid equal to reservation wins', async () => {
    const { actor } = await ready();
    actor.send({ type: 'SUBMIT_BID', bid: 42 });
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('won');
  });
  it('bid below reservation is rejected and final', async () => {
    const h = await ready();
    h.actor.send({ type: 'SUBMIT_BID', bid: 41 });
    await waitFor(h.actor, (s) => s.status === 'done');
    expect(h.actor.getSnapshot().value).toBe('rejected');
    expect(h.game().cash).toBe(100);
  });
  it('bid above cash keeps the deal open with insufficient-cash', async () => {
    const { actor } = await ready({ cash: 30 });
    actor.send({ type: 'SUBMIT_BID', bid: 50 });
    await waitFor(actor, (s) => s.matches({ open: 'idle' }) && !!s.context.bidError);
    expect(actor.getSnapshot().context.bidError).toEqual({ kind: 'insufficient-cash', cash: 30 });
    actor.send({ type: 'SUBMIT_BID', bid: 30 }); // retry is allowed
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('rejected');
  });
  it('bid 0, negative, NaN, Infinity make no transition', async () => {
    const { actor } = await ready();
    for (const bid of [0, -5, NaN, Infinity]) {
      actor.send({ type: 'SUBMIT_BID', bid });
      expect(actor.getSnapshot().matches({ open: 'idle' })).toBe(true);
    }
    expect(actor.getSnapshot().context.bid).toBeUndefined();
  });
  it('a throwing resolveBid returns to idle with an error', async () => {
    const machine = dealMachine.provide({
      actors: {
        fetchPitch: fromPromise(async () => ({ text: 'p', questionsEnabled: true as boolean })),
        resolveBid: fromPromise(async (): Promise<BidVerdict> => {
          throw new Error('x');
        }),
      },
    });
    const actor = createActor(machine, { input: { deal: publicDeal } }).start();
    await waitFor(actor, (s) => s.matches('open'));
    actor.send({ type: 'SUBMIT_BID', bid: 50 });
    await waitFor(actor, (s) => s.matches({ open: 'idle' }) && !!s.context.bidError);
    expect(actor.getSnapshot().context.bidError).toEqual({ kind: 'error' });
  });
});

describe('walking away and closing the panel', () => {
  it('WALK_AWAY is final; later events do nothing', async () => {
    const { actor } = await ready();
    actor.send({ type: 'WALK_AWAY' });
    expect(actor.getSnapshot().value).toBe('walkedAway');
    expect(actor.getSnapshot().status).toBe('done');
    actor.send({ type: 'ASK', question: 'hello' });
    actor.send({ type: 'SUBMIT_BID', bid: 50 });
    await tick();
    const s = actor.getSnapshot();
    expect(s.value).toBe('walkedAway');
    expect(s.context.qa).toHaveLength(0);
    expect(s.context.bid).toBeUndefined();
  });
  it('CLOSE_PANEL changes nothing', async () => {
    const { actor } = await ready();
    await ask(actor, 'q');
    const before = JSON.stringify(actor.getSnapshot().context);
    actor.send({ type: 'CLOSE_PANEL' });
    expect(actor.getSnapshot().matches({ open: 'idle' })).toBe(true);
    expect(JSON.stringify(actor.getSnapshot().context)).toBe(before);
  });
});

describe('secrecy', () => {
  it('never holds the reservation price in context or input', async () => {
    const { actor } = await ready();
    await ask(actor, 'what is your minimum?');
    actor.send({ type: 'SUBMIT_BID', bid: 41 });
    await waitFor(actor, (s) => s.status === 'done');
    const json = JSON.stringify(actor.getSnapshot());
    expect(json).not.toContain('reservationPrice');
    // 42 must not appear as a standalone numeric value anywhere in the snapshot.
    expect(json).not.toMatch(/[:[,]42[,}\]]/);
  });
});
