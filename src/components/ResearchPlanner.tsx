import { LengthRequest, PartPlan, ReportPlan } from '@/types/research';

const INTRO_KEYWORDS = ['introduction', 'overview'];
const CONCLUSION_KEYWORDS = ['conclusion', 'summary', 'recommendations'];

function detectExplicitParts(request: string): string[] {
  const lines = request
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const numbered = lines
    .map(line => {
      const match = line.match(/^\d+[\.)]\s*(.+)$/i);
      return match ? match[1].trim() : null;
    })
    .filter((item): item is string => Boolean(item));

  if (numbered.length >= 3) {
    return numbered;
  }

  const bullet = lines
    .map(line => {
      const match = line.match(/^[\-*•]\s*(.+)$/);
      return match ? match[1].trim() : null;
    })
    .filter((item): item is string => Boolean(item));

  return bullet.length >= 3 ? bullet : [];
}

export function planReport(request: string, length: LengthRequest): ReportPlan {
  const explicitParts = detectExplicitParts(request);
  const parts = length.parts ?? explicitParts.length || 7;

  const baseTopics: PartPlan[] = [];

  if (explicitParts.length > 0) {
    explicitParts.slice(0, parts).forEach((topic, index) => {
      baseTopics.push({
        index: index + 1,
        title: topic,
        tokens: length.tokensPerPart ?? 1100,
        keywords: topic.toLowerCase().split(/[,;\s]+/).filter(Boolean)
      });
    });
  } else {
    const defaultTitles = [
      'Introduction',
      'Regulatory framework and licensing',
      'Tax incentives and financial conditions',
      'Logistics and operational processes',
      'Risk management and compliance',
      'Business models and partnerships',
      'Conclusions and strategic recommendations'
    ];

    for (let i = 0; i < parts; i++) {
      const title = defaultTitles[i] ?? `Section ${i + 1}`;
      const keywords = title.toLowerCase().split(/[,;\s]+/).filter(Boolean);

      baseTopics.push({
        index: i + 1,
        title,
        tokens: length.tokensPerPart ?? 1100,
        keywords: keywords.length > 0 ? keywords : [`part ${i + 1}`]
      });
    }
  }

  const hasIntro = baseTopics.some(part =>
    INTRO_KEYWORDS.some(keyword => part.title.toLowerCase().includes(keyword))
  );

  if (!hasIntro) {
    baseTopics.unshift({
      index: 1,
      title: 'Introduction',
      tokens: length.tokensPerPart ?? 1100,
      keywords: ['introduction', 'overview']
    });
  }

  const hasConclusion = baseTopics.some(part =>
    CONCLUSION_KEYWORDS.some(keyword => part.title.toLowerCase().includes(keyword))
  );

  if (!hasConclusion) {
    baseTopics.push({
      index: baseTopics.length + 1,
      title: 'Conclusions and recommendations',
      tokens: length.tokensPerPart ?? 1100,
      keywords: ['conclusion', 'summary', 'recommendations']
    });
  }

  const normalizedParts = baseTopics.slice(0, parts).map((part, idx) => ({
    ...part,
    index: idx + 1
  }));

  return {
    topic: request,
    length,
    parts: normalizedParts
  };
}