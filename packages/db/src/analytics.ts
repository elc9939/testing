import { line, scaleLinear } from 'd3';

export interface MetricRow {
  label: string;
  value: number;
}

export async function createDuckDbRuntime() {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker) {
    throw new Error('DuckDB-Wasm did not provide a worker bundle.');
  }

  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();
  return { db, connection, worker };
}

export async function renderMetricBars(target: HTMLElement, rows: MetricRow[]): Promise<void> {
  const Plot = await import('@observablehq/plot');
  const plot = Plot.plot({
    width: Math.max(320, target.clientWidth || 640),
    height: 260,
    marginLeft: 96,
    color: { range: ['#4fb477'] },
    marks: [
      Plot.barX(rows, { x: 'value', y: 'label', sort: { y: '-x' }, fill: '#4fb477', rx: 3 }),
      Plot.ruleX([0])
    ]
  });
  target.replaceChildren(plot);
}

export function buildSparklinePath(values: number[], width = 240, height = 64): string {
  if (values.length === 0) return '';
  const extentMin = Math.min(...values);
  const extentMax = Math.max(...values);
  const y = scaleLinear()
    .domain(extentMin === extentMax ? [extentMin - 1, extentMax + 1] : [extentMin, extentMax])
    .range([height - 4, 4]);
  const x = scaleLinear()
    .domain([0, Math.max(1, values.length - 1)])
    .range([4, width - 4]);
  return line<number>()
    .x((_, index) => x(index))
    .y((value) => y(value))(values) ?? '';
}

