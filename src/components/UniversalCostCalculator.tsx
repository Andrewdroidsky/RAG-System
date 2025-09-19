'use client';

import { useState } from 'react';

export default function UniversalCostCalculator() {
  const [contextTokens, setContextTokens] = useState(0);
  const [promptTokens, setPromptTokens] = useState(500);
  const [outputTokens, setOutputTokens] = useState(800);
  const [queries, setQueries] = useState(1);

  // Tokenizer states
  const [contextWords, setContextWords] = useState('');
  const [promptWords, setPromptWords] = useState('');
  const [outputWords, setOutputWords] = useState('');

  // Conversion ratios
  const WORDS_TO_TOKENS = 1.8; // 1 word ≈ 1.8 tokens
  const TOKENS_TO_WORDS = 0.55; // 1 token ≈ 0.55 words

  // OpenAI GPT-4o-mini pricing
  const GPT4_INPUT_COST_PER_1K = 0.00015;  // $0.000150 per 1K input tokens
  const GPT4_OUTPUT_COST_PER_1K = 0.0006;  // $0.000600 per 1K output tokens

  // Converter functions
  const convertWordsToTokens = (words: string): number => {
    const wordCount = words.trim().split(/\s+/).filter(word => word.length > 0).length;
    return Math.round(wordCount * WORDS_TO_TOKENS);
  };

  const handleContextWordsChange = (value: string) => {
    setContextWords(value);
    if (value.trim()) {
      setContextTokens(convertWordsToTokens(value));
    }
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
      setOutputTokens(convertWordsToTokens(value));
    }
  };

  const calculateCosts = () => {
    const inputTokensPerQuery = contextTokens + promptTokens;
    const totalInputTokens = inputTokensPerQuery * queries;
    const totalOutputTokens = outputTokens * queries;

    const inputCost = (totalInputTokens / 1000) * GPT4_INPUT_COST_PER_1K;
    const outputCost = (totalOutputTokens / 1000) * GPT4_OUTPUT_COST_PER_1K;
    const totalCost = inputCost + outputCost;

    const inputCostPerQuery = (inputTokensPerQuery / 1000) * GPT4_INPUT_COST_PER_1K;
    const outputCostPerQuery = (outputTokens / 1000) * GPT4_OUTPUT_COST_PER_1K;
    const totalCostPerQuery = inputCostPerQuery + outputCostPerQuery;

    return {
      inputTokensPerQuery,
      totalInputTokens,
      totalOutputTokens,
      inputCost,
      outputCost,
      totalCost,
      inputCostPerQuery,
      outputCostPerQuery,
      totalCostPerQuery
    };
  };

  const costs = calculateCosts();

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center">
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        Universal GPT Cost Calculator
      </h3>

      {/* Input Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Context Tokens
          </label>
          <input
            type="number"
            value={contextTokens}
            onChange={(e) => setContextTokens(Number(e.target.value))}
            min="0"
            max="100000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <textarea
            value={contextWords}
            onChange={(e) => handleContextWordsChange(e.target.value)}
            placeholder="Or paste context text..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mt-2 h-16 text-xs resize-none"
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
            min="0"
            max="10000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <textarea
            value={promptWords}
            onChange={(e) => handlePromptWordsChange(e.target.value)}
            placeholder="Or paste prompt text..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mt-2 h-16 text-xs resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Output Tokens
          </label>
          <input
            type="number"
            value={outputTokens}
            onChange={(e) => setOutputTokens(Number(e.target.value))}
            min="0"
            max="10000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <textarea
            value={outputWords}
            onChange={(e) => handleOutputWordsChange(e.target.value)}
            placeholder="Or paste expected output..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mt-2 h-16 text-xs resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Number of Queries
          </label>
          <input
            type="number"
            value={queries}
            onChange={(e) => setQueries(Number(e.target.value))}
            min="1"
            max="1000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          <div className="mt-2 text-xs text-gray-500">
            Pages, questions, or API calls
          </div>
        </div>
      </div>

      {/* Cost Results */}
      <div className="space-y-4">
        <h4 className="font-medium text-gray-900">Cost Breakdown:</h4>

        {/* Per Query */}
        <div className="bg-white p-4 rounded border">
          <h5 className="font-medium text-gray-800 mb-2">Per Query:</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-gray-600">Input:</span>
              <div className="font-semibold">{costs.inputTokensPerQuery.toLocaleString()} tokens</div>
              <div className="text-green-600">${costs.inputCostPerQuery.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-gray-600">Output:</span>
              <div className="font-semibold">{outputTokens.toLocaleString()} tokens</div>
              <div className="text-blue-600">${costs.outputCostPerQuery.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total per query:</span>
              <div className="font-semibold text-lg text-green-700">${costs.totalCostPerQuery.toFixed(4)}</div>
            </div>
          </div>
        </div>

        {/* Total Project */}
        <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-4 rounded border-2 border-green-300">
          <h5 className="font-medium text-gray-800 mb-2">Total Project ({queries} queries):</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <span className="text-gray-600">Total Input:</span>
              <div className="font-semibold">{costs.totalInputTokens.toLocaleString()} tokens</div>
              <div className="text-green-600 font-semibold">${costs.inputCost.toFixed(2)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total Output:</span>
              <div className="font-semibold">{costs.totalOutputTokens.toLocaleString()} tokens</div>
              <div className="text-blue-600 font-semibold">${costs.outputCost.toFixed(2)}</div>
            </div>
            <div>
              <span className="text-gray-600">Total Project Cost:</span>
              <div className="text-2xl font-bold text-green-700">${costs.totalCost.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Warning for high costs */}
        {costs.totalCost > 50 && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">High Cost Warning</h3>
                <p className="text-sm text-red-700 mt-1">
                  This project will cost over $50. Consider optimizing your approach.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500">
        * Prices based on GPT-4o-mini: $0.00015/1K input, $0.0006/1K output<br/>
        * Conversion ratios: 1 word ≈ 1.8 tokens, 1 token ≈ 0.55 words
      </div>
    </div>
  );
}