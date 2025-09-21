import OpenAI from 'openai';
import { getEncoding, Tiktoken } from 'js-tiktoken';
import { EmbeddingsManager, EmbeddedChunk } from './embeddings';
import { FullPage } from './documentProcessor';
import { planReport } from '@/services/reportPlanner';
import { createPartQueries, scoreChunksForPart, PartQuery } from '@/services/partPlanning';
import { describeDocumentCoverage } from '@/services/documentDiagnostics';
import { LengthRequest, PartPlan, ReportPlan } from '@/types/research';

export interface RAGResponse {
  answer: string;
  sources: Array<{
    filename: string;
    sectionNumber: number;
    sectionType: 'page' | 'paragraph' | 'sheet' | 'line';
    content: string;
    relevance: number;
  }>;
  tokensUsed: number;
  cost: number;
}

interface LengthPreferences extends LengthRequest {
  totalRequestedTokens: number;
}

interface RetrievalPlan {
  chunkLimit: number;
  pageLimit: number;
  maxContextTokens: number;
}

interface ContextBuildResult {
  text: string;
  chunks: EmbeddedChunk[];
  pages: FullPage[];
}

interface PartGenerationResult {
  plan: PartPlan;
  text: string;
  sources: ContextBuildResult;
  tokensUsed: number;
  cost: number;
}

const MODEL_OUTPUT_TOKEN_LIMIT = 16000;
const MODEL_CONTEXT_TOKEN_LIMIT = 120000;
const CONTEXT_SAFETY_MARGIN = 2000;
const MIN_OUTPUT_TOKENS = 512;
const DEFAULT_TOKENS_PER_PART = 1200;
const RATE_LIMIT_TOKENS_PER_REQUEST = 15000;  // Снижаем лимит вдвое
const RATE_LIMIT_SAFETY_MARGIN = 3000;

// Адаптивные параметры поиска
const ADAPTIVE_SEARCH_CONFIG = {
  minPages: 8,            // Минимум страниц для поиска
  maxPages: 15,           // Максимум страниц для поиска (безопасно для 30k TPM)
  avgTokensPerPage: 650,  // Средний размер страницы в токенах
  avgTokensPerChunk: 250, // Средний размер chunk в токенах
  chunksPerPage: 3,       // Среднее количество chunks на страницу
};
const DEFAULT_PART_BUFFER_RATIO = 1.25;

const DETAIL_KEYWORDS = [
  'исследуй',
  'analysis',
  'review',
  'доклад',
  'research',
  'обзор',
  'strategy',
  'подробно',
  'comprehensive',
  'проанализируй',
  'deep dive'
];

const DIAGNOSTIC_KEYWORDS = [
  'list files',
  'list documents',
  'show files',
  'какие файлы',
  'сколько файлов',
  'какие документы',
  'document summary',
  'document status'
];

const RU_SYSTEM_PROMPT = [
  'Вы — помощник по анализу документов с доступом к извлеченным фрагментам и полным страницам.',
  'КРИТИЧЕСКИ ВАЖНО: Пишите ТОЛЬКО про тему текущей части. НЕ упоминайте другие темы или части.',
  'НЕ создавайте собственные заголовки - используйте только заданный заголовок части.',
  'НЕ пишите содержимое, которое относится к другим частям отчета.',
  'Отвечайте строго в рамках предоставленного контекста и ТОЛЬКО в рамках темы текущей части.',
  'Если в контексте нет информации именно по теме данной части - так и укажите.',
  'Не выдумывайте факты и не цитируйте материалы, не относящиеся к контексту',
  'Всегда указывайте источники в формате [Имя файла, страница X] для полных страниц и [Имя файла, раздел X] для фрагментов.',
  'Отвечайте только на русском языке.'
].join('\n');

const EN_SYSTEM_PROMPT = [
  'You are a document-analysis assistant with access to retrieved fragments and full pages.',
  'CRITICAL: Write ONLY about the current part\'s topic. DO NOT mention other topics or parts.',
  'DO NOT create your own headings - use only the provided part heading.',
  'DO NOT write content that belongs to other parts of the report.',
  'Answer strictly using the provided context and ONLY within the scope of the current part\'s topic.',
  'If the context lacks information specifically about this part\'s topic - state this explicitly.',
  'Do not invent facts and do not cite materials that are not in the context.',
  'Always cite sources in the format [File name, page X] for full pages and [File name, section X] for fragments.',
  'Stay strictly within the boundaries of the assigned part topic.',
  'Respond in English only.'
].join('\n');

let tokenEncoder: Tiktoken | null = null;

function getTokenEncoder(): Tiktoken | null {
  if (!tokenEncoder) {
    try {
      tokenEncoder = getEncoding('cl100k_base');
    } catch {
      tokenEncoder = null;
    }
  }
  return tokenEncoder;
}

function isDiagnosticsRequest(request: string): boolean {
  const lower = request.toLowerCase();
  return DIAGNOSTIC_KEYWORDS.some(keyword => lower.includes(keyword));
}

function parseSpecificPartRequest(request: string): { isSpecific: boolean; requestedParts: number[] } {
  // Убираем весь этот сложный парсер - он все ломает
  return {
    isSpecific: false,
    requestedParts: []
  };
}

function mergeChunks(primary: EmbeddedChunk[], secondary: EmbeddedChunk[]): EmbeddedChunk[] {
  const map = new Map<string, EmbeddedChunk>();
  [...primary, ...secondary].forEach(chunk => {
    if (!map.has(chunk.id)) {
      map.set(chunk.id, chunk);
    }
  });
  return Array.from(map.values());
}

function filterPagesForChunks(pages: FullPage[], chunks: EmbeddedChunk[]): FullPage[] {
  if (pages.length === 0 || chunks.length === 0) {
    return [];
  }

  const pageKey = (page: FullPage) => `${page.filename}-${page.pageNumber}`;
  const needed = new Set<string>();

  chunks.forEach(chunk => {
    if (chunk.metadata.sectionType === 'page') {
      needed.add(`${chunk.metadata.filename}-${chunk.metadata.sectionNumber}`);
    }
  });

  return pages.filter(page => needed.has(pageKey(page)));
}

function composePartSearchQuery(question: string, partQuery: PartQuery): string {
  return [
    question,
    `Focus topic: ${partQuery.plan.title}`,
    `Keywords: ${partQuery.focusKeywords.join(', ')}`
  ].join('\n');
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  const encoder = getTokenEncoder();
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      // fall back to heuristic
    }
  }
  return Math.ceil(text.length / 4);
}

export class RAGQueryEngine {
  private openai: OpenAI;
  private embeddings: EmbeddingsManager;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true
    });
    this.embeddings = new EmbeddingsManager(apiKey);
  }

  async query(question: string, maxSources?: number, language: 'ru' | 'en' = 'ru'): Promise<RAGResponse> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return {
        answer: language === 'ru'
          ? 'Ãâ€”ÃÂ°ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘Â ÃÂ¿Ã‘Æ’Ã‘ÂÃ‘â€š. ÃÅ¸ÃÂ¾ÃÂ¶ÃÂ°ÃÂ»Ã‘Æ’ÃÂ¹Ã‘ÂÃ‘â€šÃÂ°, Ã‘ÂÃ‘â€žÃÂ¾Ã‘â‚¬ÃÂ¼Ã‘Æ’ÃÂ»ÃÂ¸Ã‘â‚¬Ã‘Æ’ÃÂ¹Ã‘â€šÃÂµ ÃÂ²ÃÂ¾ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘Â.'
          : 'The query is empty. Please provide a question.',
        sources: [],
        tokensUsed: 0,
        cost: 0
      };
    }

    if (isDiagnosticsRequest(trimmedQuestion)) {
      const summary = await describeDocumentCoverage(this.embeddings);
      return {
        answer: summary,
        sources: [],
        tokensUsed: 0,
        cost: 0
      };
    }

    // Просто создаем обычный план без всякого парсинга
    const lengthPreferences = this.extractLengthPreferences(trimmedQuestion);
    const reportPlan = this.buildReportPlan(trimmedQuestion, lengthPreferences);
    const targetParts = reportPlan.parts;

    const totalRequestedTokens = targetParts.reduce((sum, part) => sum + (part.tokens || DEFAULT_TOKENS_PER_PART), 0);
    if (totalRequestedTokens > MODEL_OUTPUT_TOKEN_LIMIT * targetParts.length) {
      const message = language === 'ru'
        ? 'Ãâ€”ÃÂ°ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘Ë†ÃÂµÃÂ½ÃÂ½Ã‘â€¹ÃÂ¹ ÃÂ¾ÃÂ±Ã‘Å Ã‘â€˜ÃÂ¼ ÃÂ¿Ã‘â‚¬ÃÂµÃÂ²Ã‘â€¹Ã‘Ë†ÃÂ°ÃÂµÃ‘â€š ÃÂ¼ÃÂ°ÃÂºÃ‘ÂÃÂ¸ÃÂ¼ÃÂ°ÃÂ»Ã‘Å’ÃÂ½ÃÂ¾ ÃÂ¿ÃÂ¾ÃÂ´ÃÂ´ÃÂµÃ‘â‚¬ÃÂ¶ÃÂ¸ÃÂ²ÃÂ°ÃÂµÃÂ¼Ã‘â€¹ÃÂ¹ ÃÂ´ÃÂ°ÃÂ¶ÃÂµ ÃÂ¿Ã‘â‚¬ÃÂ¸ Ã‘â‚¬ÃÂ°ÃÂ·ÃÂ±ÃÂ¸ÃÂµÃÂ½ÃÂ¸ÃÂ¸ ÃÂ¿ÃÂ¾ Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃ‘ÂÃÂ¼. ÃÂ£ÃÂ¼ÃÂµÃÂ½Ã‘Å’Ã‘Ë†ÃÂ¸Ã‘â€šÃÂµ Ã‘â€šÃ‘â‚¬ÃÂµÃÂ±ÃÂ¾ÃÂ²ÃÂ°ÃÂ½ÃÂ¸Ã‘Â.'
        : 'The requested length exceeds what can be generated even when split into parts. Please reduce the requirements.';
      return {
        answer: message,
        sources: [],
        tokensUsed: 0,
        cost: 0
      };
    }

    const retrievalPlan = await this.buildRetrievalPlan(trimmedQuestion, targetParts, maxSources);
    const basePages = await this.embeddings.findRelevantPages(trimmedQuestion, retrievalPlan.pageLimit);

    // Оптимизированный поиск chunks только в релевантных страницах
    const baseChunks = await this.embeddings.searchSimilarInPages(trimmedQuestion, basePages, {
      topK: retrievalPlan.chunkLimit
    });

    const partQueries = createPartQueries(trimmedQuestion, targetParts);
    const systemPrompt = this.getSystemPrompt(language);

    const partResults: PartGenerationResult[] = [];
    let totalTokensUsed = 0;
    let totalCost = 0;

    for (const partQuery of partQueries) {
      const result = await this.generatePart(
        trimmedQuestion,
        partQuery,
        baseChunks,
        basePages,
        retrievalPlan,
        systemPrompt,
        language
      );
      partResults.push(result);
      totalTokensUsed += result.tokensUsed;
      totalCost += result.cost;
    }

    const answer = partResults
      .map(({ plan, text }) => {
        const countedTokens = estimateTokens(text);
        return [
          `**Part ${plan.index}: ${plan.title}**`,
          '',
          text,
          '',
          `_Approximate length: ~${countedTokens} tokens_`
        ].join('\n');
      })
      .join('\n\n');

    const aggregatedSources = this.aggregateSources(partResults);

    return {
      answer,
      sources: aggregatedSources,
      tokensUsed: totalTokensUsed,
      cost: totalCost
    };
  }

  getEmbeddingsManager(): EmbeddingsManager {
    return this.embeddings;
  }


  private async generatePart(
    originalQuestion: string,
    partQuery: PartQuery,
    baseChunks: EmbeddedChunk[],
    basePages: FullPage[],
    retrievalPlan: RetrievalPlan,
    systemPrompt: string,
    language: 'ru' | 'en'
  ): Promise<PartGenerationResult> {
    const searchQuery = composePartSearchQuery(originalQuestion, partQuery);

    // Специфический поиск для каждой части
    const partSpecificChunks = await this.embeddings.searchSimilarInPages(searchQuery, basePages, {
      topK: Math.max(60, Math.floor(retrievalPlan.chunkLimit * 1.5))
    });

    // Объединяем chunks и делаем специфический скоринг для части
    const allChunks = mergeChunks(baseChunks, partSpecificChunks);
    const rankedChunks = scoreChunksForPart(partQuery.plan, allChunks);

    // Берем только топ chunks для этой части с более строгим ограничением
    const selectedChunks = rankedChunks.slice(0, Math.min(retrievalPlan.chunkLimit, 35)); // Возвращаем больше chunks теперь что оптимизировали prompt
    const relatedPages = filterPagesForChunks(basePages, selectedChunks);
    const context = this.buildContext(selectedChunks, relatedPages, retrievalPlan.maxContextTokens);

    if (!context.text.trim()) {
      const fallback = language === 'ru'
        ? 'ÃÂÃÂµ Ã‘Æ’ÃÂ´ÃÂ°ÃÂ»ÃÂ¾Ã‘ÂÃ‘Å’ ÃÂ¿ÃÂ¾ÃÂ´ÃÂ¾ÃÂ±Ã‘â‚¬ÃÂ°Ã‘â€šÃ‘Å’ ÃÂºÃÂ¾ÃÂ½Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€š ÃÂ´ÃÂ»Ã‘Â ÃÂ´ÃÂ°ÃÂ½ÃÂ½ÃÂ¾ÃÂ¹ Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃÂ¸. Ãâ€™ÃÂ¾ÃÂ·ÃÂ¼ÃÂ¾ÃÂ¶ÃÂ½ÃÂ¾, Ã‘ÂÃÂ¾ÃÂ¾Ã‘â€šÃÂ²ÃÂµÃ‘â€šÃ‘ÂÃ‘â€šÃÂ²Ã‘Æ’Ã‘Å½Ã‘â€°ÃÂ¸ÃÂµ ÃÂ¼ÃÂ°Ã‘â€šÃÂµÃ‘â‚¬ÃÂ¸ÃÂ°ÃÂ»Ã‘â€¹ ÃÂ¾Ã‘â€šÃ‘ÂÃ‘Æ’Ã‘â€šÃ‘ÂÃ‘â€šÃÂ²Ã‘Æ’Ã‘Å½Ã‘â€š ÃÂ² ÃÂ·ÃÂ°ÃÂ³Ã‘â‚¬Ã‘Æ’ÃÂ¶ÃÂµÃÂ½ÃÂ½Ã‘â€¹Ã‘â€¦ ÃÂ´ÃÂ¾ÃÂºÃ‘Æ’ÃÂ¼ÃÂµÃÂ½Ã‘â€šÃÂ°Ã‘â€¦.'
        : 'No relevant context was found for this section. The uploaded documents may not contain matching information.';
      return {
        plan: partQuery.plan,
        text: fallback,
        sources: context,
        tokensUsed: 0,
        cost: 0
      };
    }

    const maxTokens = Math.min(
      MODEL_OUTPUT_TOKEN_LIMIT,
      Math.max(
        MIN_OUTPUT_TOKENS,
        Math.floor((partQuery.plan.tokens ?? DEFAULT_TOKENS_PER_PART) * DEFAULT_PART_BUFFER_RATIO)
      )
    );

    const { text, tokensUsed, cost } = await this.generateWithContext(
      systemPrompt,
      originalQuestion,
      partQuery,
      context,
      maxTokens,
      language
    );

    return {
      plan: partQuery.plan,
      text,
      sources: context,
      tokensUsed,
      cost
    };
  }

  private async generateWithContext(
    systemPrompt: string,
    originalQuestion: string,
    partQuery: PartQuery,
    context: ContextBuildResult,
    maxTokens: number,
    language: 'ru' | 'en'
  ): Promise<{ text: string; tokensUsed: number; cost: number }> {
    const contextChunks = [...context.chunks];
    const contextPages = [...context.pages];
    let contextText = this.formatContext(contextPages, contextChunks);
    let userPrompt = this.createPartPrompt(originalQuestion, partQuery, contextText, language);

    const allowedRequestTokens = 12000; // Увеличиваем теперь что оптимизировали prompt
    let promptTokens = this.estimatePromptTokens(systemPrompt, userPrompt);

    while (promptTokens + maxTokens > allowedRequestTokens && (contextChunks.length > 1 || contextPages.length > 0)) {
      if (contextChunks.length > 1) {
        contextChunks.pop();
      } else if (contextPages.length > 0) {
        contextPages.pop();
      } else {
        break;
      }
      contextText = this.formatContext(contextPages, contextChunks);
      userPrompt = this.createPartPrompt(originalQuestion, partQuery, contextText, language);
      promptTokens = this.estimatePromptTokens(systemPrompt, userPrompt);
    }


    await this.delayIfNeeded();
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.6,
      max_tokens: Math.max(MIN_OUTPUT_TOKENS, Math.min(maxTokens, allowedRequestTokens - promptTokens)),
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const choice = response.choices[0];
    let answer = choice?.message?.content?.trim() ?? '';

    if (!answer) {
      answer = language === 'ru'
        ? 'ÃÅ“ÃÂ¾ÃÂ´ÃÂµÃÂ»Ã‘Å’ ÃÂ½ÃÂµ ÃÂ²ÃÂµÃ‘â‚¬ÃÂ½Ã‘Æ’ÃÂ»ÃÂ° Ã‘ÂÃÂ¾ÃÂ´ÃÂµÃ‘â‚¬ÃÂ¶ÃÂ°Ã‘â€šÃÂµÃÂ»Ã‘Å’ÃÂ½Ã‘â€¹ÃÂ¹ ÃÂ¾Ã‘â€šÃÂ²ÃÂµÃ‘â€š. ÃÅ¸ÃÂ¾ÃÂ¿Ã‘â‚¬ÃÂ¾ÃÂ±Ã‘Æ’ÃÂ¹Ã‘â€šÃÂµ ÃÂ¿ÃÂµÃ‘â‚¬ÃÂµÃ‘â€žÃÂ¾Ã‘â‚¬ÃÂ¼Ã‘Æ’ÃÂ»ÃÂ¸Ã‘â‚¬ÃÂ¾ÃÂ²ÃÂ°Ã‘â€šÃ‘Å’ ÃÂ·ÃÂ°ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘Â.'
        : 'The model did not return a meaningful answer. Please reformulate your request.';
    }

    if (choice?.finish_reason === 'length') {
      answer += language === 'ru'
        ? '\n\n[ÃÂ¡ÃÂ¸Ã‘ÂÃ‘â€šÃÂµÃÂ¼ÃÂ½ÃÂ¾ÃÂµ ÃÂ¿Ã‘â‚¬ÃÂ¸ÃÂ¼ÃÂµÃ‘â€¡ÃÂ°ÃÂ½ÃÂ¸ÃÂµ: ÃÂ¾Ã‘â€šÃÂ²ÃÂµÃ‘â€š ÃÂ±Ã‘â€¹ÃÂ» ÃÂ¾ÃÂ±Ã‘â‚¬ÃÂµÃÂ·ÃÂ°ÃÂ½ ÃÂ¿ÃÂ¾ ÃÂ»ÃÂ¸ÃÂ¼ÃÂ¸Ã‘â€šÃ‘Æ’ Ã‘â€šÃÂ¾ÃÂºÃÂµÃÂ½ÃÂ¾ÃÂ².]'
        : '\n\n[System note: the answer was truncated due to the token limit.]';
    }

    const tokensUsed = response.usage?.total_tokens ?? 0;
    const cost = this.calculateCost(response.usage);

    return {
      text: answer,
      tokensUsed,
      cost
    };
  }

  private buildReportPlan(question: string, lengthPreferences: LengthPreferences): ReportPlan {
    const normalizedLength: LengthRequest = {
      parts: lengthPreferences.parts,
      tokensPerPart: lengthPreferences.tokensPerPart,
      explicitParts: lengthPreferences.explicitParts,
      explicitTokens: lengthPreferences.explicitTokens
    };

    return planReport(question, normalizedLength);
  }

  private aggregateSources(results: PartGenerationResult[]): RAGResponse['sources'] {
    const collected = new Map<string, {
      filename: string;
      sectionNumber: number;
      sectionType: 'page' | 'paragraph' | 'sheet' | 'line';
      content: string;
      relevance: number;
    }>();

    results.forEach((result) => {
      const { pages, chunks } = result.sources;

      pages.forEach((page, index) => {
        const key = `page-${page.filename}-${page.pageNumber}`;
        if (!collected.has(key)) {
          collected.set(key, {
            filename: page.filename,
            sectionNumber: page.pageNumber,
            sectionType: 'page',
            content: page.fullContent.slice(0, 400) + (page.fullContent.length > 400 ? '...' : ''),
            relevance: 1 - index / Math.max(pages.length, 1)
          });
        }
      });

      chunks.forEach((chunk, index) => {
        const key = `chunk-${chunk.id}`;
        if (!collected.has(key)) {
          collected.set(key, {
            filename: chunk.metadata.filename,
            sectionNumber: chunk.metadata.sectionNumber,
            sectionType: chunk.metadata.sectionType,
            content: chunk.content.slice(0, 400) + (chunk.content.length > 400 ? '...' : ''),
            relevance: 1 - index / Math.max(chunks.length, 1)
          });
        }
      });
    });

    return Array.from(collected.values());
  }

  private extractLengthPreferences(question: string): LengthPreferences {
    const partsMatch = question.match(/(\d+)\s*(?:Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€š(?:ÃÂµÃÂ¹|ÃÂ¸)?|Ã‘â‚¬ÃÂ°ÃÂ·ÃÂ´ÃÂµÃÂ»(?:ÃÂ¾ÃÂ²|ÃÂ°)?|parts?|sections?)/i);
    const tokensMatch = question.match(/(\d+)\s*(?:Ã‘â€šÃÂ¾ÃÂºÃÂµÃÂ½(?:ÃÂ¾ÃÂ²|ÃÂ°)?|token(?:s)?|Ã‘ÂÃÂ»ÃÂ¾ÃÂ²(?:ÃÂ°|ÃÂ¾|ÃÂ¾ÃÂ²)?|words?)/i);

    const explicitParts = Boolean(partsMatch);
    const explicitTokens = Boolean(tokensMatch);

    const parts = explicitParts ? Math.max(1, parseInt(partsMatch![1], 10)) : 7;
    let tokensPerPart = explicitTokens ? Math.max(400, parseInt(tokensMatch![1], 10)) : DEFAULT_TOKENS_PER_PART;

    if (!Number.isFinite(tokensPerPart)) {
      tokensPerPart = DEFAULT_TOKENS_PER_PART;
    }

    const totalRequestedTokens = parts * tokensPerPart;

    return {
      parts,
      tokensPerPart,
      explicitParts,
      explicitTokens,
      totalRequestedTokens
    };
  }

  private async calculateAdaptiveLimits(question: string, highDetail: boolean, availableTokens: number): Promise<{pageLimit: number, chunkLimit: number}> {
    // Получаем информацию о коллекции документов
    const documents = await this.embeddings.getStoredDocuments();
    const totalPages = documents.reduce((sum, doc) => sum + doc.fullPages.length, 0);

    // Базовые лимиты из конфигурации
    let targetPages = highDetail ? ADAPTIVE_SEARCH_CONFIG.maxPages : ADAPTIVE_SEARCH_CONFIG.minPages;

    // Адаптируем под размер коллекции
    if (totalPages < ADAPTIVE_SEARCH_CONFIG.minPages) {
      // Если документов меньше минимума - берем все
      targetPages = totalPages;
    } else if (totalPages > ADAPTIVE_SEARCH_CONFIG.maxPages) {
      // Если документов больше максимума - ограничиваем
      targetPages = highDetail ? ADAPTIVE_SEARCH_CONFIG.maxPages : ADAPTIVE_SEARCH_CONFIG.minPages;
    } else {
      // Если документов в пределах нормы - берем все доступные
      targetPages = totalPages;
    }

    // Проверяем ограничения по токенам
    const estimatedTokensForPages = targetPages * ADAPTIVE_SEARCH_CONFIG.avgTokensPerPage;
    if (estimatedTokensForPages > availableTokens) {
      // Если не хватает токенов - уменьшаем количество страниц
      targetPages = Math.floor(availableTokens / ADAPTIVE_SEARCH_CONFIG.avgTokensPerPage);
      targetPages = Math.max(1, Math.min(targetPages, ADAPTIVE_SEARCH_CONFIG.maxPages));
    }

    // Рассчитываем лимит chunks
    const chunkLimit = targetPages * ADAPTIVE_SEARCH_CONFIG.chunksPerPage;

    return {
      pageLimit: targetPages,
      chunkLimit: chunkLimit
    };
  }

  private async buildRetrievalPlan(question: string, targetParts: PartPlan[], manualMaxSources?: number): Promise<RetrievalPlan> {
    const avgTokensPerPart = targetParts.reduce((sum, part) => sum + (part.tokens || DEFAULT_TOKENS_PER_PART), 0) / Math.max(targetParts.length, 1);
    const highDetail = this.isHighDetailRequest(question) || targetParts.length >= 5 || avgTokensPerPart >= 1000;

    const estimatedOutput = targetParts.reduce((sum, part) => sum + (part.tokens || DEFAULT_TOKENS_PER_PART), 0) * DEFAULT_PART_BUFFER_RATIO;
    const availableForContext = MODEL_CONTEXT_TOKEN_LIMIT - estimatedOutput - CONTEXT_SAFETY_MARGIN;

    // Адаптивно рассчитываем лимиты
    const adaptiveLimits = await this.calculateAdaptiveLimits(question, highDetail, availableForContext);

    // Учитываем ручное ограничение если задано
    const chunkLimit = manualMaxSources
      ? Math.max(40, manualMaxSources)
      : adaptiveLimits.chunkLimit;

    const pageLimit = adaptiveLimits.pageLimit;

    // Пересчитываем максимальные токены контекста на основе реальных лимитов
    const estimatedContextTokens = pageLimit * ADAPTIVE_SEARCH_CONFIG.avgTokensPerPage;
    const safeTokenLimit = Math.min(
      availableForContext,
      estimatedContextTokens,
      25000  // Жесткий лимит для безопасности (оставляем запас от 30k TPM)
    );
    const maxContextTokens = safeTokenLimit;


    return {
      chunkLimit,
      pageLimit,
      maxContextTokens
    };
  }

  private buildContext(chunks: EmbeddedChunk[], pages: FullPage[], tokenBudget: number): ContextBuildResult {
    const uniqueChunksMap = new Map<string, EmbeddedChunk>();
    chunks.forEach(chunk => {
      uniqueChunksMap.set(chunk.id, chunk);
    });

    const chunksList = Array.from(uniqueChunksMap.values());
    const prioritizedChunks = this.prioritiseChunksByDocument(chunksList);

    const selectedPages: FullPage[] = [];
    let pageTokensUsed = 0;
    // Динамическое распределение токенов в зависимости от количества страниц
    const pageCount = pages.length;
    const pageTokensRatio = pageCount <= 5 ? 0.4 : pageCount <= 15 ? 0.3 : 0.25;
    const maxPageTokens = Math.floor(tokenBudget * pageTokensRatio);

    for (const page of pages) {
      const pageTokens = page.tokens || estimateTokens(page.fullContent);
      if (pageTokensUsed + pageTokens > maxPageTokens) {
        continue;
      }
      selectedPages.push(page);
      pageTokensUsed += pageTokens;
    }

    const remainingBudget = Math.max(tokenBudget - pageTokensUsed, 4000); // Больше места для chunks
    const selectedChunks: EmbeddedChunk[] = [];
    let chunkTokensUsed = 0;

    for (const chunk of prioritizedChunks) {
      const chunkTokens = chunk.metadata.tokens || estimateTokens(chunk.content);
      if (chunkTokensUsed + chunkTokens > remainingBudget) {
        if (selectedChunks.length === 0) {
          selectedChunks.push(chunk);
        }
        break;
      }
      selectedChunks.push(chunk);
      chunkTokensUsed += chunkTokens;
    }

    if (selectedChunks.length === 0 && prioritizedChunks.length > 0) {
      selectedChunks.push(prioritizedChunks[0]);
    }

    const text = this.formatContext(selectedPages, selectedChunks);

    return {
      text,
      chunks: selectedChunks,
      pages: selectedPages
    };
  }

  private getSystemPrompt(language: 'ru' | 'en'): string {
    return language === 'ru' ? RU_SYSTEM_PROMPT : EN_SYSTEM_PROMPT;
  }

  private createPartPrompt(originalQuestion: string, partQuery: PartQuery, context: string, language: 'ru' | 'en'): string {
    // Используем полный контекст без урезания
    let optimizedContext = context;

    const requirements = language === 'ru'
      ? [
          'ÃÅ¡ÃÂ¾ÃÂ½Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€š (ÃÂ¸Ã‘ÂÃÂ¿ÃÂ¾ÃÂ»Ã‘Å’ÃÂ·Ã‘Æ’ÃÂ¹Ã‘â€šÃÂµ Ã‘â€šÃÂ¾ÃÂ»Ã‘Å’ÃÂºÃÂ¾ Ã‘ÂÃ‘â€šÃÂ¸ ÃÂ¼ÃÂ°Ã‘â€šÃÂµÃ‘â‚¬ÃÂ¸ÃÂ°ÃÂ»Ã‘â€¹):',
          optimizedContext,
          'ÃÅ¾Ã‘ÂÃÂ½ÃÂ¾ÃÂ²ÃÂ½ÃÂ¾ÃÂ¹ ÃÂ¸Ã‘ÂÃ‘ÂÃÂ»ÃÂµÃÂ´ÃÂ¾ÃÂ²ÃÂ°Ã‘â€šÃÂµÃÂ»Ã‘Å’Ã‘ÂÃÂºÃÂ¸ÃÂ¹ ÃÂ²ÃÂ¾ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘Â:',
          originalQuestion,
          'ÃÂ¢ÃÂµÃÂºÃ‘Æ’Ã‘â€°ÃÂ°Ã‘Â Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃ‘Å’ ÃÂ¸Ã‘ÂÃ‘ÂÃÂ»ÃÂµÃÂ´ÃÂ¾ÃÂ²ÃÂ°ÃÂ½ÃÂ¸Ã‘Â:',
          `ÃÂÃÂ°ÃÂ·ÃÂ²ÃÂ°ÃÂ½ÃÂ¸ÃÂµ: ${partQuery.plan.title}`,
          `ÃÂ¦ÃÂµÃÂ»ÃÂµÃÂ²ÃÂ¾ÃÂ¹ ÃÂ¾ÃÂ±Ã‘Å Ã‘â€˜ÃÂ¼: ÃÂ½ÃÂµ ÃÂ¼ÃÂµÃÂ½ÃÂµÃÂµ ${partQuery.plan.tokens} Ã‘â€šÃÂ¾ÃÂºÃÂµÃÂ½ÃÂ¾ÃÂ²`,
          `ÃÅ¡ÃÂ»Ã‘Å½Ã‘â€¡ÃÂµÃÂ²Ã‘â€¹ÃÂµ Ã‘â€šÃÂµÃÂ¼Ã‘â€¹: ${partQuery.focusKeywords.join(', ')}`,
          'ÃÂ¢Ã‘â‚¬ÃÂµÃÂ±ÃÂ¾ÃÂ²ÃÂ°ÃÂ½ÃÂ¸Ã‘Â ÃÂº ÃÂ¾Ã‘â€šÃÂ²ÃÂµÃ‘â€šÃ‘Æ’:',
          '- ÃÅ¸ÃÂ¸Ã‘Ë†ÃÂ¸Ã‘â€šÃÂµ Ã‘â‚¬ÃÂ°ÃÂ·ÃÂ²ÃÂµÃ‘â‚¬ÃÂ½Ã‘Æ’Ã‘â€šÃ‘â€¹ÃÂ¼ÃÂ¸ ÃÂ°ÃÂ±ÃÂ·ÃÂ°Ã‘â€ ÃÂ°ÃÂ¼ÃÂ¸, ÃÂ±ÃÂµÃÂ· Ã‘ÂÃÂ¿ÃÂ¸Ã‘ÂÃÂºÃÂ¾ÃÂ².',
          '- ÃÅ¸Ã‘â‚¬ÃÂ¸ÃÂ²ÃÂ¾ÃÂ´ÃÂ¸Ã‘â€šÃÂµ Ã‘â€žÃÂ°ÃÂºÃ‘â€šÃ‘â€¹ ÃÂ¸ Ã‘â€žÃÂ¾Ã‘â‚¬ÃÂ¼Ã‘Æ’ÃÂ»ÃÂ¸Ã‘â‚¬ÃÂ¾ÃÂ²ÃÂºÃÂ¸ Ã‘â€šÃÂ¾ÃÂ»Ã‘Å’ÃÂºÃÂ¾ ÃÂ¸ÃÂ· ÃÂºÃÂ¾ÃÂ½Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€šÃÂ°, Ã‘Æ’ÃÂºÃÂ°ÃÂ·Ã‘â€¹ÃÂ²ÃÂ°Ã‘Â ÃÂ¸Ã‘ÂÃ‘â€šÃÂ¾Ã‘â€¡ÃÂ½ÃÂ¸ÃÂºÃÂ¸ ÃÂ² Ã‘â€žÃÂ¾Ã‘â‚¬ÃÂ¼ÃÂ°Ã‘â€šÃÂµ [ÃËœÃÂ¼Ã‘Â Ã‘â€žÃÂ°ÃÂ¹ÃÂ»ÃÂ°, Ã‘â‚¬ÃÂ°ÃÂ·ÃÂ´ÃÂµÃÂ» X], [ÃËœÃÂ¼Ã‘Â Ã‘â€žÃÂ°ÃÂ¹ÃÂ»ÃÂ°, Ã‘ÂÃ‘â€šÃ‘â‚¬ÃÂ°ÃÂ½ÃÂ¸Ã‘â€ ÃÂ° X].',
          '- ÃÂ¡ÃÂ²Ã‘ÂÃÂ¶ÃÂ¸Ã‘â€šÃÂµ ÃÂ²Ã‘â€¹ÃÂ²ÃÂ¾ÃÂ´Ã‘â€¹ Ã‘ÂÃ‘â€šÃÂ¾ÃÂ¹ Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃÂ¸ Ã‘Â ÃÂ¾ÃÂ±Ã‘â€°ÃÂµÃÂ¹ Ã‘â€šÃÂµÃÂ¼ÃÂ¾ÃÂ¹ ÃÂ¸Ã‘ÂÃ‘ÂÃÂ»ÃÂµÃÂ´ÃÂ¾ÃÂ²ÃÂ°ÃÂ½ÃÂ¸Ã‘Â.',
          '- ÃÂÃÂµ ÃÂ·ÃÂ°ÃÂ²ÃÂµÃ‘â‚¬Ã‘Ë†ÃÂ°ÃÂ¹Ã‘â€šÃÂµ ÃÂ´Ã‘â‚¬Ã‘Æ’ÃÂ³ÃÂ¸ÃÂ¼ÃÂ¸ Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃ‘ÂÃÂ¼ÃÂ¸; Ã‘ÂÃÂ¾Ã‘ÂÃ‘â‚¬ÃÂµÃÂ´ÃÂ¾Ã‘â€šÃÂ¾Ã‘â€¡Ã‘Å’Ã‘â€šÃÂµÃ‘ÂÃ‘Å’ ÃÂ½ÃÂ° Ã‘â€šÃÂµÃÂºÃ‘Æ’Ã‘â€°ÃÂµÃÂ¼ Ã‘â‚¬ÃÂ°ÃÂ·ÃÂ´ÃÂµÃÂ»ÃÂµ.'
        ]
      : [
          'Context (use only the following materials):',
          optimizedContext,
          'Primary research question:',
          originalQuestion,
          'Current section of the report:',
          `Title: ${partQuery.plan.title}`,
          `Target length: at least ${partQuery.plan.tokens} tokens`,
          `Focus areas: ${partQuery.focusKeywords.join(', ')}`,
          'Response requirements:',
          '- Structure your response with numbered subsections (e.g., 3.1, 3.2, 3.3) according to the numbering specified in the content outline or prompt, and rich paragraphs.',
          '- Use evidence from the context and cite sources in the format [File name, section X] or [File name, page X].',
          '- Connect the findings of this section to the overall research aim.',
          '- Do not summarise future sections; stay within the current part.'
        ];

    return requirements.join('\n\n');
  }

  private calculateCost(usage?: { prompt_tokens?: number; completion_tokens?: number }): number {
    if (!usage) {
      return 0;
    }
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    return (inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 15;
  }

  private getSectionLabel(sectionType: string, sectionNumber: number): string {
    switch (sectionType) {
      case 'page':
        return `page ${sectionNumber}`;
      case 'paragraph':
        return `paragraph ${sectionNumber}`;
      case 'sheet':
        return `sheet ${sectionNumber}`;
      case 'line':
        return `line ${sectionNumber}`;
      default:
        return `section ${sectionNumber}`;
    }
  }

  private isHighDetailRequest(question: string): boolean {
    const lower = question.toLowerCase();
    return DETAIL_KEYWORDS.some(keyword => lower.includes(keyword));
  }

  private prioritiseChunksByDocument(chunks: EmbeddedChunk[]): EmbeddedChunk[] {
    const byDocument = new Map<string, EmbeddedChunk[]>();
    chunks.forEach(chunk => {
      const list = byDocument.get(chunk.metadata.filename) || [];
      list.push(chunk);
      byDocument.set(chunk.metadata.filename, list);
    });

    const primary: EmbeddedChunk[] = [];
    const secondary: EmbeddedChunk[] = [];

    for (const [, list] of byDocument.entries()) {
      list.sort((a, b) => (b.metadata.tokens || estimateTokens(b.content)) - (a.metadata.tokens || estimateTokens(a.content)));
      if (list.length > 0) {
        primary.push(list[0]);
        secondary.push(...list.slice(1));
      }
    }

    const others = chunks.filter(chunk => !primary.includes(chunk) && !secondary.includes(chunk));

    return [...primary, ...secondary, ...others];
  }

  private async delayIfNeeded(): Promise<void> {
    const delayMs = 15000; // 15 секунд между запросами для соблюдения лимитов
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private countTokens(text: string): number {
    return estimateTokens(text);
  }

  private estimatePromptTokens(systemPrompt: string, userPrompt: string): number {
    return this.countTokens(systemPrompt) + this.countTokens(userPrompt);
  }

  private formatContext(pages: FullPage[], chunks: EmbeddedChunk[]): string {
    const contextSections: string[] = [];

    if (pages.length > 0) {
      contextSections.push('=== Full pages (verbatim) ===');
      pages.forEach((page) => {
        contextSections.push(`Page ${page.pageNumber} from ${page.filename}:`);
        contextSections.push(page.fullContent.trim());
        contextSections.push('');
      });
    }

    if (chunks.length > 0) {
      contextSections.push('=== Key fragments ===');
      chunks.forEach((chunk, index) => {
        const sectionLabel = this.getSectionLabel(chunk.metadata.sectionType, chunk.metadata.sectionNumber);
        contextSections.push(`Fragment ${index + 1} from ${chunk.metadata.filename}, ${sectionLabel}:`);
        contextSections.push(chunk.content.trim());
        contextSections.push('');
      });
    }

    return contextSections.join('\n').trim();
  }
}