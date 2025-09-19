// PDF.js import will be dynamic to avoid SSR issues
import { getEncoding } from 'js-tiktoken';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export interface ProcessedSection {
  sectionNumber: number;
  content: string;
  tokens: number;
  sectionType: 'page' | 'paragraph' | 'sheet' | 'line';
}

export interface FullPage {
  pageNumber: number;
  fullContent: string;
  tokens: number;
  filename: string;
}

export interface ProcessedDocument {
  filename: string;
  fileType: 'pdf' | 'docx' | 'txt' | 'xlsx';
  totalSections: number;
  totalTokens: number;
  sections: ProcessedSection[];
  fullPages: FullPage[]; // НОВОЕ: полные страницы
}

export class DocumentProcessor {
  static async processFile(file: File): Promise<ProcessedDocument> {
    const fileType = this.getFileType(file);

    switch (fileType) {
      case 'pdf':
        return this.processPDF(file);
      case 'docx':
        return this.processDOCX(file);
      case 'txt':
        return this.processTXT(file);
      case 'xlsx':
        return this.processXLSX(file);
      default:
        throw new Error(`Неподдерживаемый тип файла: ${file.type}`);
    }
  }

  private static getFileType(file: File): 'pdf' | 'docx' | 'txt' | 'xlsx' {
    const extension = file.name.toLowerCase().split('.').pop();
    const mimeType = file.type.toLowerCase();

    if (extension === 'pdf' || mimeType === 'application/pdf') {
      return 'pdf';
    } else if (extension === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return 'docx';
    } else if (extension === 'txt' || mimeType === 'text/plain') {
      return 'txt';
    } else if (extension === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return 'xlsx';
    }

    throw new Error(`Неподдерживаемый формат файла: ${extension || mimeType}`);
  }

  private static async processPDF(file: File): Promise<ProcessedDocument> {
    // Dynamic import to avoid SSR issues
    const pdfjsLib = await import('pdfjs-dist');

    // Set worker source for pdfjs
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const sections: ProcessedSection[] = [];
    const fullPages: FullPage[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: unknown) => (item as { str?: string }).str || '')
        .join(' ');

      if (pageText.trim().length > 50) {
        const tokens = this.countTokens(pageText);

        // Добавляем секцию как раньше
        sections.push({
          sectionNumber: pageNum,
          content: pageText.trim(),
          tokens,
          sectionType: 'page' as const
        });

        // НОВОЕ: Сохраняем полную страницу
        fullPages.push({
          pageNumber: pageNum,
          fullContent: pageText.trim(),
          tokens,
          filename: file.name
        });
      }
    }

    return {
      filename: file.name,
      fileType: 'pdf',
      totalSections: sections.length,
      totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
      sections,
      fullPages // НОВОЕ: добавляем полные страницы
    };
  }

  private static async processDOCX(file: File): Promise<ProcessedDocument> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });

    // Split by paragraphs (double line breaks)
    const paragraphs = result.value
      .split(/\n\s*\n/)
      .filter(p => p.trim().length > 20); // Filter out very short paragraphs

    const sections: ProcessedSection[] = paragraphs.map((content, index) => {
      const tokens = this.countTokens(content);
      return {
        sectionNumber: index + 1,
        content: content.trim(),
        tokens,
        sectionType: 'paragraph' as const
      };
    });

    return {
      filename: file.name,
      fileType: 'docx',
      totalSections: sections.length,
      totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
      sections,
      fullPages: [] // DOCX не имеет страниц, используем пустой массив
    };
  }

  private static async processTXT(file: File): Promise<ProcessedDocument> {
    const text = await file.text();

    // Split by paragraphs or every ~500 characters to keep sections manageable
    const chunks = this.splitTextIntoChunks(text, 1500); // ~1500 chars ≈ 300-400 tokens

    const sections: ProcessedSection[] = chunks.map((content, index) => {
      const tokens = this.countTokens(content);
      return {
        sectionNumber: index + 1,
        content: content.trim(),
        tokens,
        sectionType: 'paragraph' as const
      };
    });

    return {
      filename: file.name,
      fileType: 'txt',
      totalSections: sections.length,
      totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
      sections,
      fullPages: [] // TXT не имеет страниц
    };
  }

  private static async processXLSX(file: File): Promise<ProcessedDocument> {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    const sections: ProcessedSection[] = [];
    let sectionCounter = 0;

    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Convert sheet to readable text
      const sheetContent = this.convertSheetToText(sheetName, jsonData as unknown[][]);

      if (sheetContent.trim().length > 50) {
        const tokens = this.countTokens(sheetContent);
        sections.push({
          sectionNumber: ++sectionCounter,
          content: sheetContent,
          tokens,
          sectionType: 'sheet' as const
        });
      }
    });

    return {
      filename: file.name,
      fileType: 'xlsx',
      totalSections: sections.length,
      totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
      sections,
      fullPages: [] // XLSX не имеет традиционных страниц
    };
  }

  private static convertSheetToText(sheetName: string, data: unknown[][]): string {
    let content = `Лист: ${sheetName}\n\n`;

    if (data.length === 0) return content + 'Пустой лист';

    // Add headers if they exist
    if (data.length > 0) {
      const headers = data[0].map(cell => String(cell || '')).join(' | ');
      content += `Заголовки: ${headers}\n\n`;
    }

    // Add data rows (limit to first 100 rows to avoid huge texts)
    const maxRows = Math.min(data.length, 100);
    for (let i = 1; i < maxRows; i++) {
      const row = data[i];
      if (row && row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
        const rowText = row.map(cell => String(cell || '')).join(' | ');
        content += `Строка ${i}: ${rowText}\n`;
      }
    }

    if (data.length > 100) {
      content += `\n... (показано только первые 100 строк из ${data.length})`;
    }

    return content;
  }

  private static extractPagesWithNumbers(text: string): string[] {
    // Split by common page break patterns
    const pageBreaks = [
      /\n\s*\d+\s*\n/g, // Page numbers on separate lines
      /\f/g, // Form feed characters
      /\n\s*Page\s+\d+\s*\n/gi, // "Page X" patterns
    ];

    let pages = [text];

    // Apply each page break pattern
    pageBreaks.forEach(pattern => {
      const newPages: string[] = [];
      pages.forEach(page => {
        const splits = page.split(pattern);
        newPages.push(...splits);
      });
      pages = newPages;
    });

    // Filter out empty pages and normalize
    return pages
      .filter(page => page.trim().length > 50) // Minimum content threshold
      .map(page => page.trim());
  }

  private static splitTextIntoChunks(text: string, maxChars: number): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;

      if (testChunk.length > maxChars && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 20);
  }

  static countTokens(text: string): number {
    try {
      const encoding = getEncoding('cl100k_base');
      const tokens = encoding.encode(text);
      return tokens.length;
    } catch {
      // Fallback: rough estimation (4 chars per token)
      return Math.ceil(text.length / 4);
    }
  }

  static calculateCost(tokens: number): { embedding: number; query: number } {
    return {
      embedding: (tokens / 1000) * 0.0001, // $0.0001 per 1K tokens for embeddings
      query: (tokens / 1000) * 0.03 // $0.03 per 1K tokens for GPT-4
    };
  }

  static async processMultipleFiles(files: FileList): Promise<ProcessedDocument[]> {
    const promises = Array.from(files).map(file => this.processFile(file));
    return Promise.all(promises);
  }

  static getSupportedExtensions(): string[] {
    return ['pdf', 'docx', 'txt', 'xlsx'];
  }

  static getSupportedMimeTypes(): string[] {
    return [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
  }
}