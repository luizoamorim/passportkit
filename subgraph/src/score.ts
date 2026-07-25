import { ScoreSet } from '../generated/ScoreRegistry/ScoreRegistry';
import { AgentEvent, AgentLink } from '../generated/schema';
import { eventId } from './helpers';

export function handleScoreSet(event: ScoreSet): void {
  const link = AgentLink.load(event.params.agent);
  if (link != null) {
    link.score = event.params.score;
    link.save();
  }

  const ev = new AgentEvent(eventId(event));
  ev.kind = 'SCORE_SET';
  ev.agentWallet = event.params.agent;
  ev.personIdentity = link != null ? link.personIdentity : null;
  ev.score = event.params.score;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();
}
