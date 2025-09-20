import { useMemo } from 'react';
import { planReport } from '@/components/ResearchPlanner';
import { LengthRequest, PartPlan, ReportPlan } from '@/types/research';

interface UseResearchPlannerOptions {
  question: string;
  preferredLength?: LengthRequest;
}

interface ResearchPlanState {
  plan: ReportPlan;
  parts: PartPlan[];
}

export function useResearchPlanner({
  question,
  preferredLength = {}
}: UseResearchPlannerOptions): ResearchPlanState {
  const plan = useMemo(() => {
    const normalizedLength: LengthRequest = {
      parts: preferredLength.parts,
      tokensPerPart: preferredLength.tokensPerPart ?? 1100,
      explicitParts: preferredLength.explicitParts,
      explicitTokens: preferredLength.explicitTokens
    };

    return planReport(question, normalizedLength);
  }, [question, preferredLength.parts, preferredLength.tokensPerPart, preferredLength.explicitParts, preferredLength.explicitTokens]);

  return {
    plan,
    parts: plan.parts
  };
}