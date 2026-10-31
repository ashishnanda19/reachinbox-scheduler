import { Router } from 'express';
import { currentUser } from '../middleware/auth.js';
import { countSenders, createSender, listActiveSenders, MAX_SENDERS_PER_USER, type Sender } from '../services/senders.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sendersRouter = Router();

const toResponse = (sender: Sender, displayName: string) => ({ id: sender.id, email: sender.email, displayName });

sendersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json((await listActiveSenders(user.id)).map((sender) => toResponse(sender, user.name)));
  }),
);

sendersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if ((await countSenders(user.id)) >= MAX_SENDERS_PER_USER) {
      res.status(409).json({ error: 'sender_limit_reached', message: `You can have at most ${MAX_SENDERS_PER_USER} senders` });
      return;
    }
    res.status(201).json(toResponse(await createSender(user.id), user.name));
  }),
);
