import { courierAgent } from "./courier";
import { demandAgent } from "./demand";
import { financeAgent } from "./finance";
import { fulfilmentAgent } from "./fulfilment";
import { inventoryAgent } from "./inventory";
import { placementAgent } from "./placement";
import { pricingAgent } from "./pricing";
import { procurementAgent } from "./procurement";
import { returnsAgent } from "./returns";
import { riskAgent } from "./risk";
import type { Agent } from "./types";

export const PLANNING_AGENTS: Agent<any>[] = [pricingAgent, inventoryAgent, placementAgent, procurementAgent, fulfilmentAgent, courierAgent, returnsAgent, riskAgent, financeAgent];
export const TWIN_AGENTS: Agent<any>[] = [demandAgent];
export const ALL_AGENTS = [...TWIN_AGENTS, ...PLANNING_AGENTS];
