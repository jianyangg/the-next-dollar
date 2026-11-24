import { describe, expect, it } from 'vitest';
import { CENTRAL_PARK_DEAL } from '../src/core/deal.ts';
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from '../shared/limits.ts';
import { DealSession } from './dealSession.ts';
import { StubSellerModel } from './gemini.ts';
import { NEUTRAL_ANSWER } from './template.ts';
import { GOOD_LEASE_ANSWER, GOOD_PITCH, PERSONA, PUBLIC_DEAL, json, makeService, memoryStorage } from './testSupport.ts';

const pitchBody = { deal: PUBLIC_DEAL, persona: PERSONA };

function setup(steps = [{ type: 'reply' as const, rawText: json(GOOD_PITCH) }], options = {}) {
  const model = new StubSellerModel(steps);
  const { service, logs } = makeService(model, options);
  const storage = memoryStorage();
  const session = new DealSession(storage, service);
  return { model, session, storage, logs };
}

describe('DealSession: pitch', () => {
  it('stores the pitch and reports three questions remaining', async () => {
    const { session, storage } = setup();
    const result = await session.startPitch(pitchBody);
    expect(result).toEqual({
      ok: true,
      value: { text: GOOD_PITCH, source: 'model', questionsEnabled: true, questionsRemaining: MAX_QUESTIONS },
    });
    expect(storage.snapshot()?.pitch.text).toBe(GOOD_PITCH);
  });

  it('is idempotent: a second pitch request returns the stored pitch and makes no model call', async () => {
    const { session, model } = setup();
    await session.startPitch(pitchBody);
    const again = await session.startPitch(pitchBody);
    expect(again).toMatchObject({ ok: true, value: { text: GOOD_PITCH } });
    expect(model.calls).toHaveLength(1);
  });

  it('refuses a deal body that carries the hidden reservation price, and stores nothing', async () => {
    const { session, storage, model } = setup();
    const result = await session.startPitch({ deal: CENTRAL_PARK_DEAL, persona: PERSONA });
    expect(result).toEqual({ ok: false, error: 'invalid-request' });
    expect(storage.snapshot()).toBeUndefined();
    expect(model.calls).toHaveLength(0);
  });

  it('the stored state never contains a reservation price', async () => {
    const { session, storage } = setup();
    await session.startPitch(pitchBody);
    expect(JSON.stringify(storage.snapshot())).not.toMatch(/reservation|42/);
  });

  it('a failed pitch stores the template with questions disabled', async () => {
    const { session } = setup([{ type: 'reply', rawText: 'nope' }]);
    const result = await session.startPitch(pitchBody);
    expect(result).toMatchObject({ ok: true, value: { source: 'template', questionsEnabled: false, questionsRemaining: 0 } });
    expect(await session.ask({ question: 'Who runs it?' })).toEqual({ ok: false, error: 'questions-disabled' });
  });
});

describe('DealSession: questions', () => {
  const answerStep = { type: 'reply' as const, rawText: json(GOOD_LEASE_ANSWER) };

  it('refuses questions before there is a pitch', async () => {
    const { session } = setup();
    expect(await session.ask({ question: 'Hello?' })).toEqual({ ok: false, error: 'no-pitch' });
  });

  it('answers three questions, counting down, then refuses the fourth without calling the model', async () => {
    const { session, model } = setup([{ type: 'reply', rawText: json(GOOD_PITCH) }, answerStep]);
    await session.startPitch(pitchBody);

    for (let used = 1; used <= MAX_QUESTIONS; used++) {
      const r = await session.ask({ question: `Question ${used}?` });
      expect(r).toMatchObject({ ok: true, value: { source: 'model', questionsRemaining: MAX_QUESTIONS - used } });
    }
    const callsBefore = model.calls.length;
    expect(await session.ask({ question: 'One more?' })).toEqual({ ok: false, error: 'question-limit' });
    expect(model.calls).toHaveLength(callsBefore);
  });

  it('refuses a 1,000-character question and does not use up a question', async () => {
    const { session, model } = setup([{ type: 'reply', rawText: json(GOOD_PITCH) }, answerStep]);
    await session.startPitch(pitchBody);
    const callsBefore = model.calls.length;

    expect(await session.ask({ question: 'x'.repeat(1000) })).toEqual({ ok: false, error: 'question-too-long' });
    expect(await session.ask({ question: 'x'.repeat(MAX_QUESTION_CHARS + 1) })).toEqual({ ok: false, error: 'question-too-long' });
    expect(model.calls).toHaveLength(callsBefore);

    // Exactly 200 characters is allowed, and all three questions are still available.
    const ok = await session.ask({ question: 'x'.repeat(MAX_QUESTION_CHARS) });
    expect(ok).toMatchObject({ ok: true, value: { questionsRemaining: MAX_QUESTIONS - 1 } });
  });

  it('refuses empty, missing and malformed questions', async () => {
    const { session } = setup();
    await session.startPitch(pitchBody);
    for (const bad of [{ question: '   ' }, {}, { question: 5 }, null, 'text', { question: 'hi', extra: 1 }]) {
      expect(await session.ask(bad)).toEqual({ ok: false, error: 'invalid-request' });
    }
  });

  it('cannot be tricked by firing four questions at once: only three get through', async () => {
    const { session, model } = setup([{ type: 'reply', rawText: json(GOOD_PITCH) }, answerStep]);
    await session.startPitch(pitchBody);
    const results = await Promise.all([1, 2, 3, 4].map((n) => session.ask({ question: `Q${n}?` })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'question-limit' }]);
    expect(model.calls).toHaveLength(1 + 3);
  });

  it('a failed answer still spends the question but is remembered, and later questions still work', async () => {
    const { session } = setup([
      { type: 'reply', rawText: json(GOOD_PITCH) },
      { type: 'reply', rawText: json('I clear $99 a day.') }, // question 1: rejected twice
      { type: 'reply', rawText: json('I clear $99 a day.') },
      answerStep, // question 2 works
    ]);
    await session.startPitch(pitchBody);
    expect(await session.ask({ question: 'How much do you clear?' })).toEqual({
      ok: true,
      value: { text: NEUTRAL_ANSWER, source: 'neutral', questionsRemaining: 2 },
    });
    expect(await session.ask({ question: 'When does the lease renew?' })).toMatchObject({
      ok: true,
      value: { source: 'model', questionsRemaining: 1 },
    });
  });

  it('sends earlier questions and answers to the model so it has the conversation', async () => {
    const { session, model } = setup([{ type: 'reply', rawText: json(GOOD_PITCH) }, answerStep]);
    await session.startPitch(pitchBody);
    await session.ask({ question: 'First question?' });
    await session.ask({ question: 'Second question?' });
    const secondAnswerPrompt = model.calls[2]?.user ?? '';
    expect(secondAnswerPrompt).toContain('<question>First question?</question>');
    expect(secondAnswerPrompt).toContain(GOOD_LEASE_ANSWER);
    expect(secondAnswerPrompt).toContain('<question>Second question?</question>');
  });
});

describe('DealSession: close', () => {
  it('clears the conversation, so questions are refused and a new pitch starts fresh', async () => {
    const { session, storage } = setup();
    await session.startPitch(pitchBody);
    await session.close();
    expect(storage.snapshot()).toBeUndefined();
    expect(await session.ask({ question: 'Still there?' })).toEqual({ ok: false, error: 'no-pitch' });
  });

  it('asks the host to schedule an expiry when a conversation is created', async () => {
    const scheduled: number[] = [];
    const model = StubSellerModel.replying(GOOD_PITCH);
    const session = new DealSession(memoryStorage(), makeService(model).service, async (ms) => {
      scheduled.push(ms);
    });
    await session.startPitch(pitchBody);
    expect(scheduled).toEqual([24 * 60 * 60 * 1000]);
  });
});
