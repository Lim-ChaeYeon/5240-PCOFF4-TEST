export const REQUIRED_FLOWS = [
  "Flow-01",
  "Flow-02",
  "Flow-03",
  "Flow-04",
  "Flow-05",
  "Flow-06",
  "Flow-07",
  "Flow-08"
] as const;

export type FlowId = (typeof REQUIRED_FLOWS)[number];

export interface ParitySummary {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  requiredFlows: readonly FlowId[];
  coveredFlows: FlowId[];
  uncoveredFlows: FlowId[];
}

