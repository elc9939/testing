export interface TextSummary {
  label: string;
  score: number;
}

export async function classifyTextLocally(text: string, labels: string[]): Promise<TextSummary[]> {
  const { pipeline } = await import('@huggingface/transformers');
  const classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
  const result = await classifier(text, labels);
  const scores = Array.isArray(result.scores) ? result.scores : [];
  const resultLabels = Array.isArray(result.labels) ? result.labels : labels;

  return resultLabels.map((label, index) => ({
    label: String(label),
    score: Number(scores[index] ?? 0)
  }));
}

export async function summarizeLocally(text: string): Promise<string> {
  const { pipeline } = await import('@huggingface/transformers');
  const summarizer = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
  const result = await summarizer(text, { max_new_tokens: 80 });
  const first = Array.isArray(result) ? result[0] : result;
  return String(first?.summary_text ?? '');
}

export async function parseWithTreeSitter(source: string, languageWasmUrl: string): Promise<{ rootType: string; childCount: number }> {
  const { Language, Parser } = await import('web-tree-sitter');
  await Parser.init();
  const parser = new Parser();
  const language = await Language.load(languageWasmUrl);
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error('Tree-sitter parser returned no tree.');
  }
  return {
    rootType: tree.rootNode.type,
    childCount: tree.rootNode.childCount
  };
}
