'use client';

import { useState } from 'react';

interface ResearchCostCalculatorProps {
  totalTokens: number;
  totalDocuments: number;
  totalChunks: number;
}

export default function ResearchCostCalculator({
  totalTokens,
  totalDocuments,
  totalChunks
}: ResearchCostCalculatorProps) {
  const [pages, setPages] = useState(15);
  const [promptTokens, setPromptTokens] = useState(500);
  const [outputTokensPerPage, setOutputTokensPerPage] = useState(800);

  // Tokenizer states
  const [promptWords, setPromptWords] = useState('');
  const [outputWords, setOutputWords] = useState('');
  const [tokensToConvert, setTokensToConvert] = useState('');
  const [wordsToConvert, setWordsToConvert] = useState('');

  // Conversion ratios
  const WORDS_TO_TOKENS = 1.8; // 1 word ≈ 1.8 tokens
  const TOKENS_TO_WORDS = 0.55; // 1 token ≈ 0.55 words

  // OpenAI GPT-4 pricing (as of 2024)
  const GPT4_INPUT_COST_PER_1K = 0.03;  // $0.03 per 1K input tokens
  const GPT4_OUTPUT_COST_PER_1K = 0.06; // $0.06 per 1K output tokens

  // Converter functions
  const convertWordsToTokens = (words: string): number => {
    const wordCount = words.trim().split(/\s+/).filter(word => word.length > 0).length;
    return Math.round(wordCount * WORDS_TO_TOKENS);
  };

  const convertTokensToWords = (tokens: number): number => {
    return Math.round(tokens * TOKENS_TO_WORDS);
  };

  const handlePromptWordsChange = (value: string) => {
    setPromptWords(value);
    if (value.trim()) {
      setPromptTokens(convertWordsToTokens(value));
    }
  };

  const handleOutputWordsChange = (value: string) => {
    setOutputWords(value);
    if (value.trim()) {
      setOutputTokensPerPage(convertWordsToTokens(value));
    }
  };

  const calculateCosts = () => {
    // Input tokens per query: document context + user prompt
    const inputTokensPerQuery = totalTokens + promptTokens;

    // Output tokens per page
    const outputTokensTotal = outputTokensPerPage * pages;

    // Total input tokens for all pages
    const totalInputTokens = inputTokensPerQuery * pages;

    // Calculate costs
    const inputCost = (totalInputTokens / 1000) * GPT4_INPUT_COST_PER_1K;
    const outputCost = (outputTokensTotal / 1000) * GPT4_OUTPUT_COST_PER_1K;
    const totalCost = inputCost + outputCost;

    // Per page costs
    const inputCostPerPage = (inputTokensPerQuery / 1000) * GPT4_INPUT_COST_PER_1K;
    const outputCostPerPage = (outputTokensPerPage / 1000) * GPT4_OUTPUT_COST_PER_1K;
    const totalCostPerPage = inputCostPerPage + outputCostPerPage;

    return {
      totalInputTokens,
      outputTokensTotal,
      inputCost,
      outputCost,
      totalCost,
      inputCostPerPage,
      outputCostPerPage,
      totalCostPerPage,
      inputTokensPerQuery,
      outputTokensPerPage
    };
  };

  const costs = calculateCosts();

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold text-amber-900 mb-4 flex items-center">
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
        </svg>
        Research Cost Calculator
      </h3>

      {/* Document Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-white rounded border">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{totalDocuments}</div>
          <div className="text-sm text-gray-600">Documents</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{totalChunks.toLocaleString()}</div>
          <div className="text-sm text-gray-600">Fragments</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-600">{totalTokens.toLocaleString()}</div>
          <div className="text-sm text-gray-600">Context Tokens</div>
        </div>
      </div>

      {/* Tokenizer Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h4 className="font-medium text-blue-900 mb-3">Words ↔ Tokens Converter</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Words to Tokens */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Words → Tokens (×1.8)
            </label>
            <input
              type="number"
              value={wordsToConvert}
              onChange={(e) => setWordsToConvert(e.target.value)}
              placeholder="Enter number of words or paste text below..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
            <textarea
              value={wordsToConvert}
              onChange={(e) => setWordsToConvert(e.target.value)}
              placeholder="Or paste your text here to count words and tokens..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-16 text-sm resize-none"
            />
            {wordsToConvert.trim() && (
              <div className="mt-2 text-sm">
                {isNaN(Number(wordsToConvert)) ? (
                  <>
                    <span className="text-gray-600">Words: </span>
                    <span className="font-semibold">{wordsToConvert.trim().split(/\s+/).filter(w => w.length > 0).length}</span>
                    <span className="text-gray-600"> → Tokens: </span>
                    <span className="font-semibold text-blue-600">{Math.round(wordsToConvert.trim().split(/\s+/).filter(w => w.length > 0).length * WORDS_TO_TOKENS)}</span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-600">Words: </span>
                    <span className="font-semibold">{Number(wordsToConvert)}</span>
                    <span className="text-gray-600"> → Tokens: </span>
                    <span className="font-semibold text-blue-600">{Math.round(Number(wordsToConvert) * WORDS_TO_TOKENS)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Tokens to Words */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tokens → Words (×0.55)
            </label>
            <textarea
              value={tokensToConvert}
              onChange={(e) => setTokensToConvert(e.target.value)}
              placeholder="Enter token count..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 text-sm resize-none"
            />
            {tokensToConvert && (
              <div className="mt-2 text-sm">
                <span className="text-gray-600">Tokens: </span>
                <span className="font-semibold">{tokensToConvert}</span>
                <span className="text-gray-600"> → Words: </span>
                <span className="font-semibold text-green-600">{convertTokensToWords(Number(tokensToConvert))}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Research Pages
          </label>
          <input
            type="number"
            value={pages}
            onChange={(e) => setPages(Number(e.target.value))}
            min="1"
            max="100"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Prompt Tokens
          </label>
          <input
            type="number"
            value={promptTokens}
            onChange={(e) => setPromptTokens(Number(e.target.value))}
            min="100"
            max="5000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <textarea
            value={promptWords}
            onChange={(e) => handlePromptWordsChange(e.target.value)}
            placeholder="Or paste prompt text here..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 mt-2 h-16 text-xs"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Output Tokens/Page
          </label>
          <input
            type="number"
            value={outputTokensPerPage}
            onChange={(e) => setOutputTokensPerPage(Number(e.target.value))}
            min="200"
            max="4000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <textarea
            value={outputWords}
            onChange={(e) => handleOutputWordsChange(e.target.value)}
            placeholder="Or paste expected output text here..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 mt-2 h-16 text-xs"
          />
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="space-y-4">
        <h4 className="font-medium text-gray-900">Cost Breakdown:</h4>

        {/* Per Page */}
        <div className="bg-white p-4 rounded border">
          <h5 className="font-medium text-gray-800 mb-2">Per Page:</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-gray-600">Input:</span>
              <div className="font-semibold">{costs.inputTokensPerQuery.toLocaleString()} tokens</div>
              <div className="text-green-600">${costs.inputCostPerPage.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-gray-600">Output:</span>
              <div className="font-semibold">{costs.outputTokensPerPage.toLocaleString()} tokens</div>
              <div className="text-blue-600">${costs.outputCostPerPage.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total per page:</span>
              <div className="font-semibold text-lg text-amber-700">${costs.totalCostPerPage.toFixed(4)}</div>
            </div>
          </div>
        </div>

        {/* Total Project */}
        <div className="bg-gradient-to-r from-amber-100 to-yellow-100 p-4 rounded border-2 border-amber-300">
          <h5 className="font-medium text-gray-800 mb-2">Total Project ({pages} pages):</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <span className="text-gray-600">Total Input:</span>
              <div className="font-semibold">{costs.totalInputTokens.toLocaleString()} tokens</div>
              <div className="text-green-600 font-semibold">${costs.inputCost.toFixed(2)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total Output:</span>
              <div className="font-semibold">{costs.outputTokensTotal.toLocaleString()} tokens</div>
              <div className="text-blue-600 font-semibold">${costs.outputCost.toFixed(2)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total Project Cost:</span>
              <div className="text-2xl font-bold text-amber-700">${costs.totalCost.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Warning if cost is high */}
        {costs.totalCost > 20 && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">High Cost Warning</h3>
                <p className="text-sm text-red-700 mt-1">
                  This research project will cost over $20. Consider reducing pages or output length.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500">
        * Prices based on GPT-4 rates: $0.03/1K input tokens, $0.06/1K output tokens<br/>
        * Conversion ratios: 1 word ≈ 1.8 tokens, 1 token ≈ 0.55 words
      </div>
    </div>
  );
}