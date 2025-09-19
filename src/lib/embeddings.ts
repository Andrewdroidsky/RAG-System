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
                tokens: Math.ceil(item.chunk.length / 4)
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

  async searchSimilar(query: string, topK: number = 50): Promise<EmbeddedChunk[]> {
    const queryEmbedding = await this.createEmbedding(query);
    const documents = await this.loadFromStorage();

    const allChunks = documents.flatMap(doc => doc.chunks);

    // Calculate cosine similarity
    const similarities = allChunks.map(chunk => ({
      chunk,
      similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    // Sort by similarity and return top K
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map(item => item.chunk);
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
}