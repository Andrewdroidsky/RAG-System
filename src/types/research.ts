export interface LengthRequest {
  parts?: number;
  tokensPerPart?: number;
  explicitParts?: boolean;
  explicitTokens?: boolean;
}

export interface PartPlan {
  index: number;
  title: string;
  tokens: number;
  keywords: string[];
}

export interface ReportPlan {
  topic: string;
  length: LengthRequest;
  parts: PartPlan[];
}