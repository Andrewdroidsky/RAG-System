import OpenAI from 'openai';
import { EmbeddingsManager, EmbeddedChunk } from './embeddings';
import { FullPage } from './documentProcessor';

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
    // Адаптивный выбор количества источников и токенов
    let maxTokens = 2000; // По умолчанию

    if (!maxSources) {
      const questionLower = question.toLowerCase();
      if (questionLower.includes('list') || questionLower.includes('all') ||
          questionLower.includes('перечисли') || questionLower.includes('все') ||
          questionLower.includes('read') || questionLower.includes('прочитай') ||
          questionLower.includes('detailed') || questionLower.includes('подробно') ||
          questionLower.includes('analysis') || questionLower.includes('анализ')) {
        maxSources = 25; // Для списков и полного анализа
        maxTokens = 8000; // Большой лимит для детального анализа
      } else if (questionLower.includes('compare') || questionLower.includes('сравни') ||
                 questionLower.includes('difference') || questionLower.includes('различия')) {
        maxSources = 15; // Для сравнений
        maxTokens = 4000; // Средний лимит
      } else {
        maxSources = 8; // Для обычных вопросов
        maxTokens = 2000; // Обычный лимит
      }
    }

    // Проверяем на запросы создания контента (части, разделы)
    const isContentCreation = question.includes('части') || question.includes('разделы') ||
                              question.includes('sections') || question.includes('токенов') ||
                              question.includes('tokens') || /\d+\s*(части|part|раздел|section)/.test(question);

    if (isContentCreation) {
      maxTokens = 16000; // Максимальный лимит для gpt-4o
    }

    // НОВОЕ: Двухэтапный поиск
    // 1. Найти релевантные полные страницы
    const relevantPages = await this.embeddings.findRelevantPages(question, 5);

    // 2. Найти chunks из релевантных страниц
    const relevantChunks = await this.embeddings.searchSimilar(question, maxSources);

    // Фильтруем chunks только из релевантных страниц (для лучшей точности)
    const pageNumbers = new Set(relevantPages.map(page => page.pageNumber));
    const filteredChunks = relevantChunks.filter(chunk =>
      pageNumbers.has(chunk.metadata.sectionNumber)
    );

    if (filteredChunks.length === 0) {
      return {
        answer: 'Извините, я не нашел релевантной информации в загруженных документах для ответа на ваш вопрос.',
        sources: [],
        tokensUsed: 0,
        cost: 0
      };
    }

    // Build context from relevant pages + chunks
    const context = this.buildContext(filteredChunks, maxSources, relevantPages);

    // Create prompt
    const prompt = this.createPrompt(question, context, language);

    // Language-specific system prompts
    const systemPrompts = {
      ru: `Вы - система анализа документов. У вас есть доступ к содержимому загруженных файлов через предоставленный контекст.

          ВАЖНО: Вы МОЖЕТЕ и ДОЛЖНЫ читать и анализировать содержимое документов из контекста.

          Ваши возможности:
          - Читать и анализировать все документы из контекста
          - Отвечать на вопросы о содержимом файлов
          - Перечислять файлы и их содержимое
          - Находить информацию в документах
          - Создавать подробные, детальные ответы любой длины
          - Писать развернутые анализы и отчеты

          ПРАВИЛА ОТВЕТОВ:
          - Если пользователь просит создать части/разделы с указанием токенов - создавайте ПОЛНЫЕ разделы указанной длины
          - ТРЕБОВАНИЕ: Каждая часть должна содержать минимум 800-1200 токенов (примерно 3-5 абзацев)
          - Для запросов анализа, списков, чтения - давайте максимально подробные ответы
          - Используйте ВСЮ доступную информацию из контекста
          - НЕ сокращайте ответы до нескольких предложений
          - ВАЖНО: Развернуто объясняйте каждый пункт, приводите примеры, детали и контекст
          - Если пользователь указал количество токенов - это СТРОГОЕ требование к длине

          ВАЖНО ПРО ССЫЛКИ:
          - Ссылайтесь только на страницы, которые показаны ПОЛНОСТЬЮ в разделе "ПОЛНЫЕ СТРАНИЦЫ"
          - Используйте формат [Название файла, стр. X] только для полных страниц
          - Для фрагментов используйте [Фрагмент из файла, стр. X]
          - Будьте точны в ссылках - не утверждайте больше, чем видите

          Если нужной информации нет в контексте, скажите об этом честно.
          Отвечайте на русском языке.`,
      en: `You are a document analysis system. You have access to uploaded file contents through the provided context.

          IMPORTANT: You CAN and SHOULD read and analyze document content from the context.

          Your capabilities:
          - Read and analyze all documents from the context
          - Answer questions about file contents
          - List files and their contents
          - Find information in documents
          - Create detailed, comprehensive responses of any length
          - Write thorough analyses and reports

          RESPONSE RULES:
          - If user requests parts/sections with token specifications - create FULL sections of specified length
          - REQUIREMENT: Each part must contain minimum 800-1200 tokens (approximately 3-5 paragraphs)
          - For analysis, listing, reading requests - provide maximally detailed responses
          - Use ALL available information from the context
          - DO NOT shorten responses to just a few sentences
          - IMPORTANT: Explain each point thoroughly, provide examples, details and context
          - If user specifies token count - this is a STRICT length requirement

          IMPORTANT ABOUT REFERENCES:
          - Only reference pages that are shown COMPLETELY in "FULL PAGES" section
          - Use format [File name, page X] only for full pages
          - For fragments use [Fragment from file, page X]
          - Be precise in references - don't claim more than you see

          If the needed information is not in the context, say so honestly.
          Answer in English.`
    };

    // Query OpenAI
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompts[language]
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: maxTokens
    });

    const answer = response.choices[0]?.message?.content || 'Извините, не удалось получить ответ.';
    const tokensUsed = response.usage?.total_tokens || 0;

    // GPT-4o pricing: $5 per 1M input tokens, $15 per 1M output tokens
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = (inputTokens / 1000000) * 5 + (outputTokens / 1000000) * 15;

    // Process sources
    const sources = filteredChunks.map((chunk, index) => ({
      filename: chunk.metadata.filename,
      sectionNumber: chunk.metadata.sectionNumber,
      sectionType: chunk.metadata.sectionType,
      content: chunk.content.substring(0, 200) + '...',
      relevance: 1 - (index / filteredChunks.length) // Simple relevance score
    }));

    return {
      answer,
      sources,
      tokensUsed,
      cost
    };
  }

  private buildContext(chunks: EmbeddedChunk[], maxSources: number = 8, fullPages: FullPage[] = []): string {
    // Адаптивный лимит контекста в зависимости от количества источников
    const maxContextLength = maxSources > 15 ? 15000 : maxSources > 10 ? 12000 : 8000;
    let totalLength = 0;
    const selectedChunks: EmbeddedChunk[] = [];

    for (const chunk of chunks) {
      const chunkText = `[Источник ${selectedChunks.length + 1}: ${chunk.metadata.filename}, ${this.getSectionLabel(chunk.metadata.sectionType, chunk.metadata.sectionNumber)}]\n${chunk.content}\n---\n`;

      if (totalLength + chunkText.length > maxContextLength && selectedChunks.length > 0) {
        break; // Прекращаем добавление, если превышаем лимит
      }

      selectedChunks.push(chunk);
      totalLength += chunkText.length;
    }

    // НОВОЕ: Сначала показываем полные страницы, потом chunks
    let context = '';

    // Добавляем полные страницы если есть
    if (fullPages.length > 0) {
      context += '=== ПОЛНЫЕ СТРАНИЦЫ ДЛЯ СПРАВКИ ===\n\n';
      fullPages.forEach((page, index) => {
        context += `СТРАНИЦА ${page.pageNumber} (${page.filename}):\n${page.fullContent}\n\n`;
      });
      context += '=== РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ ===\n\n';
    }

    // Добавляем релевантные chunks
    context += selectedChunks
      .map((chunk, index) => {
        const sectionLabel = this.getSectionLabel(chunk.metadata.sectionType, chunk.metadata.sectionNumber);
        return `[Источник ${index + 1}: ${chunk.metadata.filename}, ${sectionLabel}]\n${chunk.content}\n`;
      })
      .join('\n---\n');

    return context;
  }

  private getSectionLabel(sectionType: string, sectionNumber: number): string {
    switch (sectionType) {
      case 'page':
        return `стр. ${sectionNumber}`;
      case 'paragraph':
        return `параграф ${sectionNumber}`;
      case 'sheet':
        return `лист ${sectionNumber}`;
      case 'line':
        return `строка ${sectionNumber}`;
      default:
        return `раздел ${sectionNumber}`;
    }
  }

  private createPrompt(question: string, context: string, language: 'ru' | 'en'): string {
    const isContentCreation = question.includes('части') || question.includes('разделы') ||
                              question.includes('sections') || question.includes('токенов') ||
                              question.includes('tokens') || /\d+\s*(части|part|раздел|section)/.test(question);

    const prompts = {
      ru: `Контекст из загруженных документов:
${context}

Пользователь спрашивает: ${question}

${isContentCreation ? `
🚨 ОБЯЗАТЕЛЬНЫЙ СЧЕТЧИК СЛОВ! СТРОГО СЛЕДУЙТЕ!

ДЛЯ КАЖДОЙ ЧАСТИ ПИШИТЕ МИНИМУМ 800 СЛОВ!

ФОРМАТ ОТВЕТА:

**ЧАСТЬ 1: [Название]**

Эта часть должна содержать развернутый анализ первого аспекта темы. Начинаю с детального рассмотрения основных принципов и концепций, которые лежат в основе данного раздела. Важно подчеркнуть, что каждый элемент требует глубокого понимания и всестороннего изучения. Рассматривая данную тему, необходимо обратить внимание на множество факторов, которые влияют на конечный результат. Детальный анализ показывает, что существует прямая связь между различными компонентами системы. Углубляясь в изучение вопроса, становится очевидным, что необходимо учитывать не только основные аспекты, но и второстепенные элементы. Практический опыт демонстрирует важность комплексного подхода к решению поставленных задач. Исследования в данной области показывают, что эффективность достигается через систематическое применение проверенных методик. Анализируя имеющуюся информацию, можно выделить ключевые моменты, которые определяют успешность реализации проекта.

[ПРОДОЛЖАЙТЕ ПИСАТЬ ПОДОБНЫМ ОБРАЗОМ ДО 800+ СЛОВ]

**ЧАСТЬ 2: [Название]**

[СНОВА 800+ СЛОВ В ТАКОМ ЖЕ РАЗВЕРНУТОМ СТИЛЕ]

ТРЕБОВАНИЕ: КАЖДАЯ ЧАСТЬ = МИНИМУМ 800 СЛОВ!
` : ''}

Проанализируйте предоставленный контекст и ответьте на вопрос. Вы можете читать и анализировать все документы из контекста выше.

Обязательно укажите источники в формате [Название файла, стр./параграф/лист X] для каждого утверждения.`,
      en: `Context from uploaded documents:
${context}

User asks: ${question}

${isContentCreation ? `
🚨 MANDATORY WORD COUNT! STRICTLY FOLLOW!

WRITE MINIMUM 800 WORDS FOR EACH PART!

RESPONSE FORMAT:

**PART 1: [Title]**

This part must contain a comprehensive analysis of the first aspect of the topic. I begin with a detailed examination of the fundamental principles and concepts that form the foundation of this section. It is important to emphasize that each element requires deep understanding and thorough study. When examining this topic, it is necessary to pay attention to the numerous factors that influence the final outcome. Detailed analysis shows that there is a direct connection between various system components. Delving deeper into the study of the question, it becomes obvious that it is necessary to consider not only the main aspects, but also secondary elements. Practical experience demonstrates the importance of a comprehensive approach to solving the tasks at hand. Research in this field shows that effectiveness is achieved through systematic application of proven methodologies. Analyzing the available information, key points can be identified that determine the success of project implementation.

[CONTINUE WRITING IN THIS MANNER UNTIL 800+ WORDS]

**PART 2: [Title]**

[AGAIN 800+ WORDS IN THE SAME COMPREHENSIVE STYLE]

REQUIREMENT: EACH PART = MINIMUM 800 WORDS!
` : ''}

Analyze the provided context and answer the question. You can read and analyze all documents from the context above.

Make sure to cite sources in format [File name, page/paragraph/sheet X] for each statement.`
    };

    return prompts[language];
  }

  getEmbeddingsManager(): EmbeddingsManager {
    return this.embeddings;
  }
}