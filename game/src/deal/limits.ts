/**
 * Diligence-question limits for a seller deal (CONFIGURATION.md A7 "Question limit").
 *
 * They live in their own dependency-free file so the browser's deal machine and the
 * server's request validation import the same numbers. The server remains the
 * authority (a modified browser must not be able to raise them); the client uses
 * the same constants only to avoid sending requests the server would refuse.
 */
export const MAX_QUESTIONS = 3;
export const MAX_QUESTION_CHARS = 200;
