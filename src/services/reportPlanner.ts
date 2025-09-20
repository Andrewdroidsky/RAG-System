import { LengthRequest, PartPlan, ReportPlan } from '@/types/research';

const INTRO_KEYWORDS = ['introduction', 'введение', 'overview'];
const CONCLUSION_KEYWORDS = ['conclusion', 'summary', 'вывод', 'заключение', 'recommendations'];

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

function normalizeKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[,;:\/\-\s]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

export function planReport(request: string, length: LengthRequest): ReportPlan {
  const explicitParts = detectExplicitParts(request);
  const requestedParts = length.parts ?? explicitParts.length || 7;

  const baseTopics: PartPlan[] = [];

  if (explicitParts.length > 0) {
    explicitParts.slice(0, requestedParts).forEach((topic, index) => {
      baseTopics.push({
        index: index + 1,
        title: topic,
        tokens: length.tokensPerPart ?? 1100,
        keywords: normalizeKeywords(topic)
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

    for (let i = 0; i < requestedParts; i++) {
      const title = defaultTitles[i] ?? `Section ${i + 1}`;
      const keywords = normalizeKeywords(title);

      baseTopics.push({
        index: i + 1,
        title,
        tokens: length.tokensPerPart ?? 1100,
        keywords: keywords.length > 0 ? keywords : [`part-${i + 1}`]
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

  const normalizedParts = baseTopics.slice(0, requestedParts).map((part, idx) => ({
    ...part,
    index: idx + 1
  }));

  return {
    topic: request,
    length,
    parts: normalizedParts
  };
}