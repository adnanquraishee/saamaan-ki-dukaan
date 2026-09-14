import type { ActionEnvelope } from "@/lib/config/envelopes";
import type { AppState } from "@/lib/store/state";
import type { AgentId, Proposal } from "@/lib/types";

export interface Agent<O = unknown> {
  id: AgentId;
  name: string;
  envelope: ActionEnvelope;
  perceive(state: AppState): O;
  decide(obs: O): Proposal[]; // never mutates
}
