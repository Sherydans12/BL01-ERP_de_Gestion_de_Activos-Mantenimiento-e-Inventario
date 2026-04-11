import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

interface CaptchaEntry {
  answer: number;
  expiresAt: number;
}

/** CAPTCHA matemático generado en servidor (sin Google ni servicios externos). */
@Injectable()
export class CaptchaService {
  private readonly store = new Map<string, CaptchaEntry>();
  private readonly ttlMs = 5 * 60 * 1000;

  create(): { challengeId: string; question: string } {
    this.pruneExpired();
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const challengeId = crypto.randomUUID();
    this.store.set(challengeId, {
      answer: a + b,
      expiresAt: Date.now() + this.ttlMs,
    });
    return { challengeId, question: `${a} + ${b}` };
  }

  /**
   * Consume el reto (un solo uso). Devuelve false si falta id, expiró o la respuesta no coincide.
   */
  validate(challengeId: string | undefined, answerRaw: unknown): boolean {
    if (!challengeId || answerRaw === undefined || answerRaw === null) {
      return false;
    }
    const entry = this.store.get(challengeId);
    this.store.delete(challengeId);
    if (!entry || Date.now() > entry.expiresAt) {
      return false;
    }
    const n =
      typeof answerRaw === 'number'
        ? answerRaw
        : parseInt(String(answerRaw).trim(), 10);
    return Number.isFinite(n) && n === entry.answer;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, e] of this.store.entries()) {
      if (now > e.expiresAt) this.store.delete(id);
    }
  }
}
