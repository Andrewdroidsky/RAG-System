# RAG Documents System

A Retrieval-Augmented Generation (RAG) system built with Next.js, TypeScript, and OpenAI that allows users to upload documents and perform intelligent queries against them.

## 🌍 Language / Язык

[🇺🇸 English](README.md) | [🇷🇺 Русский](README.ru.md)

## Documentation
- [Roadmap](ROADMAP.md) | [План развития](ROADMAP.ru.md)
- [Architecture](ARCHITECTURE.md) | [Архитектура](ARCHITECTURE.ru.md)
- [Improvements](IMPROVEMENTS.md) | [Улучшения](IMPROVEMENTS.ru.md)

## ✨ Features

- **Multi-format Document Support**: Upload and process PDF, DOCX, and XLSX files
- **Intelligent Document Processing**: Automatic text extraction and chunking
- **Vector Search**: Semantic search using OpenAI embeddings
- **Multi-part Report Generation**: Structured reports with configurable length
- **Bilingual Support**: Interface available in English and Russian
- **Local Storage**: Documents stored locally using IndexedDB
- **Cost Tracking**: Monitor OpenAI API usage and costs
- **Research Planning**: Automated research planning with part-based analysis

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- OpenAI API key

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd rag-documents
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Add your OpenAI API key to `.env.local`:
```
OPENAI_API_KEY=your_openai_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## 📖 Usage

### Upload Documents
1. Click "Upload Documents" or drag and drop files
2. Supported formats: PDF, DOCX, XLSX
3. Wait for processing and embedding generation

### Query Documents
1. Enter your question in the query interface
2. Specify desired report length and number of parts
3. The system will generate a structured response with citations

### Example Queries
- "Analyze the benefits of country/location for creating a report/enterprise"
- "Create a 5-part report on regulatory frameworks with 1500 tokens per part"
- "Compare tax incentives across different Freeport locations"

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS
- **AI/ML**: OpenAI GPT-4o, text-embedding-3-small
- **Storage**: IndexedDB, LocalStorage
- **Document Processing**: PDF.js, Mammoth.js, XLSX
- **Development**: ESLint, Turbopack

## 📁 Project Structure

```
src/
├── app/                 # Next.js app router
├── components/          # React components
│   ├── DocumentManager.tsx
│   ├── QueryInterface.tsx
│   └── ResearchPlanner.tsx
├── lib/                 # Core libraries
│   ├── documentProcessor.ts
│   ├── embeddings.ts
│   ├── ragQuery.ts
│   └── indexedDbStorage.ts
├── services/            # Business logic
│   ├── reportPlanner.ts
│   ├── partPlanning.ts
│   └── documentDiagnostics.ts
└── types/              # TypeScript definitions
```

## 🔧 Configuration

### Embedding Settings
- Model: `text-embedding-3-small`
- Chunk size: 1000 tokens
- Batch processing: 50 chunks per batch

### Generation Settings
- Model: `gpt-4o`
- Max tokens per part: 16,000
- Context window: 120,000 tokens
- Temperature: 0.6

## 🎯 Current Capabilities

- **Document Processing**: Extracts text while preserving page structure
- **Semantic Search**: Finds relevant content using vector similarity
- **Hierarchical Retrieval**: First finds relevant pages, then specific chunks
- **Multi-part Generation**: Creates structured reports with multiple sections
- **Source Attribution**: Provides citations for all generated content
- **Progress Tracking**: Real-time feedback during processing

## 🚧 Known Limitations

- Simple sentence-based chunking may lose context
- Basic cosine similarity without reranking
- Limited document structure preservation
- No cross-document relationship detection
- Single-language embedding model

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues or have questions:
1. Check the [documentation](ARCHITECTURE.md)
2. Review [planned improvements](IMPROVEMENTS.md)
3. Open an issue on GitHub

## 🔮 What's Next?

See our [Roadmap](ROADMAP.md) for planned features and improvements, including:
- Enhanced semantic chunking
- Hybrid search capabilities
- Advanced document structure preservation
- Multi-modal content support

---

**Built with ❤️ using OpenAI and Next.js**