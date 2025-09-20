import { EmbeddedChunk } from '@/lib/embeddings';
import { PartPlan } from '@/types/research';

export interface PartQuery {
  plan: PartPlan;
  query: string;
  focusKeywords: string[];
}

export function createPartQueries(question: string, parts: PartPlan[]): PartQuery[] {
  return parts.map((plan) => {
    const keywords = plan.keywords.length > 0 ? plan.keywords : [plan.title];

    const promptLines = [
      `Topic: ${plan.title}`,
      `Target length: ~${plan.tokens} tokens`,
      `Focus areas: ${keywords.join(', ')}`,
      '',
      'Answer requirements:',
      '- Stay within the specified topic; mention only the focus areas if relevant in the question.',
      '- Use evidence from the retrieved fragments and cite sources.',
      '- Provide structured paragraphs (no bullet lists unless explicitly requested).',
      '- Explain the importance for the overall research storyline.'
    ];

    return {
      plan,
      query: promptLines.join('\n'),
      focusKeywords: keywords
    };
  });
}

export function scoreChunksForPart(part: PartPlan, chunks: EmbeddedChunk[]): EmbeddedChunk[] {
  const keywords = part.keywords.map(keyword => keyword.toLowerCase());

  const scored = chunks.map(chunk => {
    const text = chunk.content.toLowerCase();
    const keywordMatches = keywords.reduce((acc, keyword) =>
      acc + (text.includes(keyword) ? 1 : 0), 0
    );

    const proximityScore = chunk.metadata.tokens > 0
      ? Math.min(1, keywordMatches / Math.max(keywords.length, 1))
      : 0;

    const combinedScore = chunk.metadata.tokens > 0
      ? proximityScore + (chunk.metadata.tokens / 4000)
      : proximityScore;

    return {
      chunk,
      score: combinedScore
    };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.chunk);
}