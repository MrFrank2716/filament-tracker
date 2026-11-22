import type { Router } from 'express';
import { z } from 'zod';
import { parse } from '@/http';
import { rateLimit } from '@/rateLimit';
import { aiStatus, askAboutWorkshop, getDailySummary, QUESTION_MAX_CHARS } from '@/services/ai';

const askSchema = z.object({ question: z.string().trim().min(3, 'Ask a question').max(QUESTION_MAX_CHARS, `Keep the question under ${QUESTION_MAX_CHARS} characters`) });

/** A few questions a minute per person, on top of the daily allowances in services/ai.ts. */
const askLimit = rateLimit(6, 60_000, { key: (req) => `ai:${req.userId}`, message: 'That is a lot of questions in a row. Wait a minute, then ask again.' });

/**
 * The AI assistant. Reading the status and today's summary is open to every member; asking is for operators and up
 * (POST /ai/ask is in OPERATOR_WRITES; viewers are refused by the guard). Nothing here changes workshop data.
 */
export function registerAiRoutes(router: Router): void {
  router.get('/ai/status', async (req, res) => {
    res.json(await aiStatus(req.workspaceId, req.userId, req.role === 'owner'));
  });

  router.get('/ai/summary', async (req, res) => {
    res.json(await getDailySummary(req.workspaceId));
  });

  router.post('/ai/ask', askLimit, async (req, res) => {
    const { question } = parse(askSchema, req.body);
    res.json(await askAboutWorkshop(req.workspaceId, req.userId, question));
  });
}
