# RAG System

A powerful Retrieval-Augmented Generation system for document processing and querying.

## Features

- 📄 Multi-format support: PDF, DOCX, TXT, XLSX
- 🔍 Accurate citations with page/section references
- 💾 Unlimited document capacity using IndexedDB
- 💰 Token counting and cost estimation
- ⚡ Batch processing for optimal performance
- 🎯 Precise source attribution in responses

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure OpenAI API Key:**

   Edit `.env.local` and replace the placeholder with your actual OpenAI API key:
   ```
   NEXT_PUBLIC_OPENAI_API_KEY=sk-your-actual-openai-api-key-here
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```

## Usage

1. Open the application in your browser
2. Upload documents (PDF, DOCX, TXT, XLSX)
3. Wait for processing and embedding creation
4. Ask questions about your documents
5. Get answers with accurate source citations

## Deployment

The application is configured for static export and can be deployed to Netlify, Vercel, or any static hosting service.

## Security Note

The OpenAI API key is embedded in the client-side application. For production use with untrusted users, consider implementing a backend API to secure the key.