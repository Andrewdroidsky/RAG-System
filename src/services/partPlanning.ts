import { EmbeddedChunk } from '@/lib/embeddings';
import { PartPlan } from '@/types/research';

export interface PartQuery {
  plan: PartPlan;
  query: string;
  focusKeywords: string[];
}

export function createPartQueries(question: string, parts: PartPlan[]): PartQuery[] {
  return parts.map((plan, index) => {
    const keywords = plan.keywords.length > 0 ? plan.keywords : [plan.title];
    const partNumber = index + 1;
    const totalParts = parts.length;

    const promptLines = [
      `IMPORTANT: This is Part ${partNumber} of ${totalParts} in a structured report.`,
      `Part ${partNumber} Topic: ${plan.title}`,
      `Target length: ~${plan.tokens} tokens`,
      `Focus areas: ${keywords.join(', ')}`,
      '',
      'Answer requirements:',
      `- Begin with heading "Part ${partNumber}: ${plan.title}"`,
      '- Stay within the specified topic; mention only the focus areas if relevant in the question.',
      '- Use evidence from the retrieved fragments and cite sources.',
      '- Provide structured paragraphs (no bullet lists unless explicitly requested).',
      '- Explain the importance for the overall research storyline.',
      `- This is Part ${partNumber} ONLY - do not repeat content from other parts.`
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
  const title = part.title.toLowerCase();

  const scored = chunks.map(chunk => {
    const text = chunk.content.toLowerCase();
    let score = 0;

    // 1. Точные совпадения с ключевыми словами (высокий вес)
    let exactMatches = 0;
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = (text.match(regex) || []).length;
      exactMatches += matches;
      score += matches * 2; // Высокий бонус за точные совпадения
    });

    // 2. Частичные совпадения с ключевыми словами
    keywords.forEach(keyword => {
      if (text.includes(keyword)) {
        score += 1;
      }
    });

    // 3. Совпадения с заголовком части
    const titleWords = title.split(/\s+/).filter(word => word.length > 2);
    titleWords.forEach(word => {
      if (text.includes(word)) {
        score += 1.5;
      }
    });

    // 4. Длина контента (меньший вес)
    const lengthBonus = Math.min(0.5, chunk.metadata.tokens / 2000);
    score += lengthBonus;

    // 5. Штраф за слишком короткие или слишком длинные фрагменты
    if (chunk.metadata.tokens < 50) {
      score *= 0.5; // Штраф за слишком короткие
    } else if (chunk.metadata.tokens > 1500) {
      score *= 0.8; // Небольшой штраф за слишком длинные
    }

    // 6. Бонус за релевантность контекста (проверяем наличие связанных терминов)
    const contextBonus = calculateContextRelevance(text, keywords, title);
    score += contextBonus;

    // 7. Weighted Relationship Scoring - используем иерархическую информацию
    const hierarchyBonus = calculateHierarchyRelevance(chunk, part, keywords);
    score += hierarchyBonus;

    return {
      chunk,
      score: Math.max(0, score),
      exactMatches,
      debug: {
        keywords: keywords.join(', '),
        exactMatches,
        lengthBonus,
        contextBonus,
        finalScore: score
      }
    };
  });

  // Фильтруем только те фрагменты, которые имеют хотя бы минимальную релевантность
  return scored
    .filter(item => item.score > 0.1 || item.exactMatches > 0)
    .sort((a, b) => {
      // Приоритет: сначала по точным совпадениям, потом по общему скору
      if (a.exactMatches !== b.exactMatches) {
        return b.exactMatches - a.exactMatches;
      }
      return b.score - a.score;
    })
    .map(item => item.chunk);
}

function calculateContextRelevance(text: string, keywords: string[], title: string): number {
  let contextScore = 0;

  // Проверяем плотность ключевых слов в тексте
  const totalWords = text.split(/\s+/).length;
  let keywordDensity = 0;

  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = (text.match(regex) || []).length;
    keywordDensity += matches;
  });

  const density = keywordDensity / Math.max(totalWords, 1);
  contextScore += Math.min(1, density * 100); // Нормализуем плотность

  // Проверяем семантическую близость (простая эвристика)
  const semanticWords = extractSemanticWords(title);
  semanticWords.forEach(word => {
    if (text.includes(word)) {
      contextScore += 0.3;
    }
  });

  return Math.min(2, contextScore); // Ограничиваем максимальный бонус
}

function extractSemanticWords(title: string): string[] {
  // Извлекаем семантически связанные слова для лучшего скоринга
  const semanticMap: Record<string, string[]> = {
    'introduction': ['overview', 'background', 'purpose', 'scope'],
    'regulatory': ['law', 'legal', 'compliance', 'rules', 'regulation'],
    'tax': ['taxation', 'fiscal', 'revenue', 'deduction', 'exemption'],
    'logistics': ['supply', 'transport', 'delivery', 'warehouse', 'distribution'],
    'risk': ['security', 'threat', 'vulnerability', 'mitigation', 'assessment'],
    'business': ['commercial', 'enterprise', 'company', 'organization'],
    'conclusion': ['result', 'finding', 'outcome', 'recommendation', 'summary']
  };

  const words: string[] = [];
  const titleLower = title.toLowerCase();

  Object.entries(semanticMap).forEach(([key, values]) => {
    if (titleLower.includes(key)) {
      words.push(...values);
    }
  });

  return words;
}

function calculateHierarchyRelevance(chunk: EmbeddedChunk, part: PartPlan, keywords: string[]): number {
  let hierarchyScore = 0;

  if (!chunk.metadata.hierarchy) {
    return 0;
  }

  const hierarchy = chunk.metadata.hierarchy;

  // 1. Проверяем заголовки рядом с chunk
  hierarchy.nearbyHeadings.forEach(heading => {
    const headingLower = heading.toLowerCase();
    keywords.forEach(keyword => {
      if (headingLower.includes(keyword)) {
        hierarchyScore += 3; // Высокий бонус за совпадение с заголовками
      }
    });

    // Проверяем совпадение с названием части
    const partTitleWords = part.title.toLowerCase().split(/\s+/);
    partTitleWords.forEach(word => {
      if (word.length > 2 && headingLower.includes(word)) {
        hierarchyScore += 2;
      }
    });
  });

  // 2. Проверяем цепочку belongsTo
  hierarchy.belongsTo.forEach((parentElement, index) => {
    const parentLower = parentElement.toLowerCase();
    keywords.forEach(keyword => {
      if (parentLower.includes(keyword)) {
        // Чем ближе к chunk, тем больше бонус
        const proximityBonus = 2 - (index * 0.3);
        hierarchyScore += Math.max(0.5, proximityBonus);
      }
    });
  });

  // 3. Проверяем родительскую секцию
  if (hierarchy.parentSection) {
    const parentLower = hierarchy.parentSection.toLowerCase();
    keywords.forEach(keyword => {
      if (parentLower.includes(keyword)) {
        hierarchyScore += 2.5; // Высокий бонус за прямого родителя
      }
    });
  }

  // 4. Бонус за позицию в документе
  const structuralBonus = calculateStructuralPositionBonus(hierarchy.structuralContext, part);
  hierarchyScore += structuralBonus;

  // 5. Штраф за несоответствие структурного контекста
  const structuralPenalty = calculateStructuralPenalty(hierarchy, part);
  hierarchyScore -= structuralPenalty;

  return Math.min(5, hierarchyScore); // Ограничиваем максимальный бонус
}

function calculateStructuralPositionBonus(structuralContext: string, part: PartPlan): number {
  const context = structuralContext.toLowerCase();
  const partTitle = part.title.toLowerCase();

  // Бонусы для Introduction в начале документа
  if (partTitle.includes('introduction') && context.includes('beginning')) {
    return 1.5;
  }

  // Бонусы для Conclusion в конце документа
  if ((partTitle.includes('conclusion') || partTitle.includes('recommendation')) && context.includes('end')) {
    return 1.5;
  }

  // Бонус для основных частей в середине
  if (context.includes('middle') && !partTitle.includes('introduction') && !partTitle.includes('conclusion')) {
    return 0.5;
  }

  return 0;
}

function calculateStructuralPenalty(hierarchy: EmbeddedChunk['metadata']['hierarchy'], part: PartPlan): number {
  let penalty = 0;

  // Штраф если chunk явно относится к другой теме
  const conflictingTopics = [
    { keywords: ['tax', 'налог'], topics: ['logistics', 'логистика', 'risk', 'риск'] },
    { keywords: ['logistics', 'логистика'], topics: ['tax', 'налог', 'regulatory', 'нормативн'] },
    { keywords: ['risk', 'риск'], topics: ['tax', 'налог', 'business', 'бизнес'] },
    { keywords: ['regulatory', 'нормативн'], topics: ['logistics', 'логистика'] }
  ];

  const partTitleLower = part.title.toLowerCase();
  const allHierarchyText = [
    ...hierarchy.belongsTo,
    ...hierarchy.nearbyHeadings,
    hierarchy.parentSection || ''
  ].join(' ').toLowerCase();

  conflictingTopics.forEach(conflict => {
    const hasPartKeywords = conflict.keywords.some(kw => partTitleLower.includes(kw));
    const hasConflictingTopics = conflict.topics.some(topic => allHierarchyText.includes(topic));

    if (hasPartKeywords && hasConflictingTopics) {
      penalty += 2; // Значительный штраф за тематический конфликт
    }
  });

  return penalty;
}