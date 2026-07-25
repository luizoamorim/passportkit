import { PolicySet } from '../generated/EligibilityGate/EligibilityGate';
import { Policy, Protocol } from '../generated/schema';
import { topicName } from './helpers';

export function handlePolicySet(event: PolicySet): void {
  const policyId = event.params.policyId;
  const topics = event.params.topics;

  let policy = Policy.load(policyId.toString());
  if (policy == null) {
    policy = new Policy(policyId.toString());
    policy.policyId = policyId;
  }
  const names: string[] = [];
  for (let i = 0; i < topics.length; i++) names.push(topicName(topics[i]));
  policy.topics = topics;
  policy.topicNames = names;
  policy.updatedAt = event.block.timestamp;
  policy.save();

  // singleton registry so other mappings can enumerate policies + find the gate
  let protocol = Protocol.load('protocol');
  if (protocol == null) {
    protocol = new Protocol('protocol');
    protocol.policyIds = [];
  }
  protocol.gate = event.address;
  const ids = protocol.policyIds;
  let known = false;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i].equals(policyId)) {
      known = true;
      break;
    }
  }
  if (!known) {
    ids.push(policyId);
    protocol.policyIds = ids;
  }
  protocol.save();
}
