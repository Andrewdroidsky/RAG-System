import OpenAI from 'openai';
import { ProcessedDocument, ProcessedSection, FullPage } from './documentProcessor';
import { indexedDBStorage } from './indexedDbStorage';

export interface EmbeddedChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    filename: string;
    sectionNumber: number;
    sectionType: 'page' | 'paragraph' | 'sheet' | 'line';
    tokens: number;
    // Hierarchical Structure Preservation
    hierarchy: {
      documentTitle?: string;
      parentSection?: string;
      belongsTo: string[]; // Chain of parent sections
      nearbyHeadings: string[]; // Headings found nearby
      structuralContext: string; // Context about position in document
    };
  };
}

export interface StoredDocument {
  id: string;
  filename: string;
  chunks: EmbeddedChunk[];
  fullPages: FullPage[]; // НОВОЕ: полные страницы
  createdAt: string;
}

export class EmbeddingsManager {
  private openai: OpenAI;
  private useIndexedDB = true; // Use IndexedDB for large files
  private batchSize = 50; // Process embeddings in larger batches
  public onProgress?: (progress: { current: number; total: number; stage: string }) => void;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  async createEmbeddings(documents: ProcessedDocument[]): Promise<StoredDocument[]> {
    const storedDocs: StoredDocument[] = [];

    // Calculate total chunks for progress tracking
    const allTextChunks: Array<{doc: ProcessedDocument, section: ProcessedSection, chunk: string, chunkIndex: number}> = [];

    for (const doc of documents) {
      for (const section of doc.sections) {
        const sectionChunks = this.splitIntoChunks(section.content, 1000);
        sectionChunks.forEach((chunk, i) => {
          allTextChunks.push({ doc, section, chunk, chunkIndex: i });
        });
      }
    }

    this.onProgress?.({ current: 0, total: allTextChunks.length, stage: 'Создание эмбеддингов' });

    // Process in batches to avoid rate limits
    const processedChunks = new Map<string, EmbeddedChunk[]>();

    for (let i = 0; i < allTextChunks.length; i += this.batchSize) {
      const batch = allTextChunks.slice(i, i + this.batchSize);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const embedding = await this.createEmbedding(item.chunk);
          return {
            docFilename: item.doc.filename,
            chunk: {
              id: `${item.doc.filename}-${item.section.sectionNumber}-${item.chunkIndex}`,
              content: item.chunk,
              embedding,
              metadata: {
                filename: item.doc.filename,
                sectionNumber: item.section.sectionNumber,
                sectionType: item.section.sectionType,
                tokens: Math.ceil(item.chunk.length / 4),
                // Временно отключаем иерархию для тестирования
                hierarchy: {
                  belongsTo: [],
                  nearbyHeadings: [],
                  structuralContext: ""
                }
              }
            }
          };
        })
      );

      // Collect successful results
      batchResults.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
          const { docFilename, chunk } = result.value;
          if (!processedChunks.has(docFilename)) {
            processedChunks.set(docFilename, []);
          }
          processedChunks.get(docFilename)!.push(chunk);
        }

        this.onProgress?.({
          current: i + batchIndex + 1,
          total: allTextChunks.length,
          stage: `Обработано ${i + batchIndex + 1} из ${allTextChunks.length} фрагментов`
        });
      });

      // Reduced delay between batches for faster processing
      if (i + this.batchSize < allTextChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Build final documents
    for (const doc of documents) {
      const chunks = processedChunks.get(doc.filename) || [];
      storedDocs.push({
        id: doc.filename,
        filename: doc.filename,
        chunks,
        fullPages: doc.fullPages, // НОВОЕ: сохраняем полные страницы
        createdAt: new Date().toISOString()
      });
    }

    this.onProgress?.({ current: allTextChunks.length, total: allTextChunks.length, stage: 'Сохранение в базу данных' });
    await this.saveToStorage(storedDocs);

    return storedDocs;
  }

  private async createEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });

    return response.data[0].embedding;
  }

  private splitIntoChunks(text: string, maxTokens: number): string[] {
    const sentences = text.split(/[.!?]+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      const testChunk = currentChunk + sentence + '.';
      const estimatedTokens = Math.ceil(testChunk.length / 4);

      if (estimatedTokens > maxTokens && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + '.';
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 10);
  }

  async searchSimilar(
    query: string,
    optionsOrTopK?: number | { topK?: number; minScore?: number; ensurePerDocument?: boolean }
  ): Promise<EmbeddedChunk[]> {
    const queryEmbedding = await this.createEmbedding(query);
    const documents = await this.loadFromStorage();

    const allChunks = documents.flatMap(doc => doc.chunks);

    if (allChunks.length === 0) {
      return [];
    }

    type ScoredChunk = { chunk: EmbeddedChunk; similarity: number };

    const options = typeof optionsOrTopK === 'number'
      ? { topK: optionsOrTopK }
      : optionsOrTopK ?? {};

    const topK = options.topK ?? 50;
    const ensurePerDocument = options.ensurePerDocument ?? false;
    const minScore = options.minScore ?? -Infinity;

    const scored: ScoredChunk[] = allChunks.map(chunk => ({
      chunk,
      similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    const sorted: ScoredChunk[] = scored
      .filter(item => item.similarity >= minScore)
      .sort((a, b) => b.similarity - a.similarity);

    if (sorted.length === 0) {
      return [];
    }

    let ordered: EmbeddedChunk[];

    if (ensurePerDocument) {
      const primary: ScoredChunk[] = [];
      const secondary: ScoredChunk[] = [];
      const seenDocs = new Set<string>();

      for (const item of sorted) {
        const docId = item.chunk.metadata.filename;
        if (!seenDocs.has(docId)) {
          primary.push(item);
          seenDocs.add(docId);
        } else {
          secondary.push(item);
        }
      }

      ordered = [...primary, ...secondary].map(item => item.chunk);
    } else {
      ordered = sorted.map(item => item.chunk);
    }

    if (Number.isFinite(topK)) {
      const limit = Math.max(1, Number(topK));
      return ordered.slice(0, limit);
    }

    return ordered;
  }

  // НОВОЕ: Поиск chunks только в релевантных страницах
  async searchSimilarInPages(query: string, relevantPages: FullPage[], options?: { topK?: number; minScore?: number }): Promise<EmbeddedChunk[]> {
    const queryEmbedding = await this.createEmbedding(query);
    const documents = await this.loadFromStorage();

    // Фильтруем chunks только по релевантным страницам
    const relevantChunks: EmbeddedChunk[] = [];

    for (const doc of documents) {
      for (const chunk of doc.chunks) {
        // Проверяем, относится ли chunk к одной из релевантных страниц
        const isRelevant = relevantPages.some(page =>
          page.filename === chunk.metadata.filename &&
          page.pageNumber === chunk.metadata.sectionNumber
        );

        if (isRelevant) {
          relevantChunks.push(chunk);
        }
      }
    }

    if (relevantChunks.length === 0) {
      return [];
    }

    // Рассчитываем похожесть и сортируем
    const scored = relevantChunks.map(chunk => ({
      chunk,
      similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    const topK = options?.topK ?? 50;
    const minScore = options?.minScore ?? -Infinity;

    const filtered = scored
      .filter(item => item.similarity >= minScore)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return filtered.map(item => item.chunk);
  }

  // НОВОЕ: Поиск релевантных полных страниц
  async findRelevantPages(query: string, topK: number = 5): Promise<FullPage[]> {
    const queryEmbedding = await this.createEmbedding(query);
    const documents = await this.loadFromStorage();

    const allPages: Array<{ page: FullPage, avgSimilarity: number }> = [];

    // Для каждой страницы вычисляем среднюю похожесть её chunks
    for (const doc of documents) {
      for (const page of doc.fullPages) {
        // Находим все chunks этой страницы
        const pageChunks = doc.chunks.filter(chunk =>
          chunk.metadata.sectionNumber === page.pageNumber
        );

        if (pageChunks.length > 0) {
          // Вычисляем среднюю похожесть chunks страницы
          const similarities = pageChunks.map(chunk =>
            this.cosineSimilarity(queryEmbedding, chunk.embedding)
          );
          const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

          allPages.push({ page, avgSimilarity });
        }
      }
    }

    // Возвращаем топ страниц по релевантности
    return allPages
      .sort((a, b) => b.avgSimilarity - a.avgSimilarity)
      .slice(0, topK)
      .map(item => item.page);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private async saveToStorage(documents: StoredDocument[]): Promise<void> {
    if (this.useIndexedDB) {
      await indexedDBStorage.saveDocuments(documents);
    } else {
      // Fallback to localStorage for small files
      try {
        const existing = this.loadFromStorageSync();
        const combined = [...existing, ...documents];
        const dataToStore = JSON.stringify(combined);

        if (dataToStore.length > 5 * 1024 * 1024) { // 5MB
          throw new Error('Data too large for localStorage');
        }

        localStorage.setItem('rag-embeddings', dataToStore);
      } catch (error) {
        console.warn('Switching to IndexedDB due to storage error:', error);
        this.useIndexedDB = true;
        await indexedDBStorage.saveDocuments(documents);
      }
    }
  }

  private loadFromStorageSync(): StoredDocument[] {
    try {
      const stored = localStorage.getItem('rag-embeddings');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private async loadFromStorage(): Promise<StoredDocument[]> {
    if (this.useIndexedDB) {
      return await indexedDBStorage.loadAllDocuments();
    } else {
      return this.loadFromStorageSync();
    }
  }

  async getStoredDocuments(): Promise<StoredDocument[]> {
    return await this.loadFromStorage();
  }

  async clearStorage(): Promise<void> {
    if (this.useIndexedDB) {
      await indexedDBStorage.clearAll();
    } else {
      localStorage.removeItem('rag-embeddings');
    }
  }

  async removeDocument(filename: string): Promise<void> {
    if (this.useIndexedDB) {
      await indexedDBStorage.removeDocument(filename);
    } else {
      const documents = this.loadFromStorageSync();
      const filtered = documents.filter(doc => doc.filename !== filename);
      localStorage.setItem('rag-embeddings', JSON.stringify(filtered));
    }
  }

  private extractHierarchy(doc: ProcessedDocument, section: ProcessedSection, chunk: string): EmbeddedChunk['metadata']['hierarchy'] {
    // Extract headings and structure from content
    const nearbyHeadings = this.findNearbyHeadings(chunk, section.content);
    const belongsTo = this.buildBelongsToChain(doc, section);
    const structuralContext = this.determineStructuralContext(doc, section);

    return {
      documentTitle: doc.filename.replace(/\.[^/.]+$/, ""), // Remove extension
      parentSection: this.findParentSection(doc, section),
      belongsTo,
      nearbyHeadings,
      structuralContext
    };
  }

  private findNearbyHeadings(chunk: string, fullSectionContent: string): string[] {
    const headings: string[] = [];
    const chunkPos = fullSectionContent.indexOf(chunk);

    if (chunkPos === -1) return headings;

    // Look for headings before and after the chunk
    const contextBefore = fullSectionContent.substring(Math.max(0, chunkPos - 500), chunkPos);
    const contextAfter = fullSectionContent.substring(chunkPos + chunk.length, chunkPos + chunk.length + 500);

    // Simple regex for common heading patterns
    const headingRegex = /(?:^|\n)([A-Z][A-Za-z0-9\s]{3,50})(?:\n|$)/g;

    let match;
    while ((match = headingRegex.exec(contextBefore)) !== null) {
      const heading = match[1].trim();
      if (heading.length > 3 && heading.length < 100) {
        headings.unshift(heading); // Add to beginning for chronological order
      }
    }

    while ((match = headingRegex.exec(contextAfter)) !== null) {
      const heading = match[1].trim();
      if (heading.length > 3 && heading.length < 100) {
        headings.push(heading);
      }
    }

    return headings.slice(0, 5); // Limit to 5 most relevant headings
  }

  private buildBelongsToChain(doc: ProcessedDocument, section: ProcessedSection): string[] {
    const chain: string[] = [];

    // Add document-level context
    chain.push(doc.filename);

    // Add section context based on section type and number
    if (section.sectionType === 'page') {
      chain.push(`Page ${section.sectionNumber}`);
    } else if (section.sectionType === 'paragraph') {
      chain.push(`Paragraph ${section.sectionNumber}`);
    } else {
      chain.push(`Section ${section.sectionNumber} (${section.sectionType})`);
    }

    // Try to extract logical sections from content
    const logicalSections = this.extractLogicalSections(section.content);
    chain.push(...logicalSections);

    return chain;
  }

  private extractLogicalSections(content: string): string[] {
    const sections: string[] = [];

    // Look for common section indicators
    const sectionIndicators = [
      /(?:^|\n)(Introduction|Введение)/gi,
      /(?:^|\n)(Background|Предпосылки)/gi,
      /(?:^|\n)(Methodology|Методология)/gi,
      /(?:^|\n)(Results|Результаты)/gi,
      /(?:^|\n)(Discussion|Обсуждение)/gi,
      /(?:^|\n)(Conclusion|Заключение)/gi,
      /(?:^|\n)(Regulatory|Нормативная база)/gi,
      /(?:^|\n)(Tax|Налоги)/gi,
      /(?:^|\n)(Logistics|Логистика)/gi,
      /(?:^|\n)(Risk|Риски)/gi
    ];

    sectionIndicators.forEach(regex => {
      const matches = content.match(regex);
      if (matches) {
        matches.forEach(match => {
          const cleaned = match.replace(/^[\n\r]+/, '').trim();
          if (cleaned && !sections.includes(cleaned)) {
            sections.push(cleaned);
          }
        });
      }
    });

    return sections.slice(0, 3); // Limit to 3 most relevant logical sections
  }

  private findParentSection(doc: ProcessedDocument, section: ProcessedSection): string | undefined {
    // Find the previous section that might be a parent (like a heading)
    const currentIndex = doc.sections.findIndex(s =>
      s.sectionNumber === section.sectionNumber && s.sectionType === section.sectionType
    );

    if (currentIndex > 0) {
      const previousSection = doc.sections[currentIndex - 1];
      // If previous section is shorter and might be a heading
      if (previousSection.content.length < 200 && previousSection.content.trim().length > 0) {
        return previousSection.content.trim().substring(0, 100);
      }
    }

    return undefined;
  }

  private determineStructuralContext(doc: ProcessedDocument, section: ProcessedSection): string {
    const totalSections = doc.sections.length;
    const currentIndex = doc.sections.findIndex(s =>
      s.sectionNumber === section.sectionNumber && s.sectionType === section.sectionType
    );

    let position = "middle";
    if (currentIndex < totalSections * 0.25) {
      position = "beginning";
    } else if (currentIndex > totalSections * 0.75) {
      position = "end";
    }

    return `${position} of document (${currentIndex + 1}/${totalSections} sections)`;
  }
}